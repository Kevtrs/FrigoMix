/**
 * LaFabrikViewer — moteur de la visionneuse 3D (Three.js, sans framework).
 *
 * Unité de scène : le millimètre. Repère : origine au centre de la surface du papier,
 * X à droite, Y en haut, Z vers le spectateur. Le cadre ne bouge pas : c'est la caméra
 * qui tourne autour (éclairage studio fixe, comme une prise de vue produit).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildRodalm, rodalmMetrics } from './rodalm.js';
import { detectTier, TIERS } from './quality.js';

const DEG = Math.PI / 180;

/** Finitions de filament → paramètres PBR. */
export const FINISHES = {
  matte: { roughness: 0.82, metalness: 0, label: 'PLA mat' },
  basic: { roughness: 0.48, metalness: 0, label: 'PLA standard' },
  glossy: { roughness: 0.26, metalness: 0, label: 'PETG brillant' },
  silk: { roughness: 0.3, metalness: 0.28, label: 'PLA silk' },
  metal: { roughness: 0.38, metalness: 0.75, label: 'PLA métallisé' },
};

export const VIEWS = {
  initial: null, // défini par la config produit
  front: { azimuthDeg: 0, elevationDeg: 0 },
  side: { azimuthDeg: 90, elevationDeg: 0 },
  back: { azimuthDeg: 180, elevationDeg: 0 },
  top: { azimuthDeg: 0, elevationDeg: 70 },
};

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function shortestAngle(from, to) {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return from + d;
}

/** Stries de couches FDM procédurales sur les flancs des pièces (visibles en gros plan). */
function addLayerLines(material, layerHeight = 0.2, strength = 0.22) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLayerH = { value: layerHeight };
    shader.uniforms.uLayerAmp = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLfWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLfWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLfWorld;\nuniform float uLayerH;\nuniform float uLayerAmp;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 zView = normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
          float wall = 1.0 - smoothstep(0.55, 0.85, abs(dot(normal, zView)));
          float ph = vLfWorld.z / uLayerH;
          float fw = fwidth(ph);
          float amp = uLayerAmp * wall * clamp(1.0 - fw * 1.4, 0.0, 1.0);
          normal = normalize(normal + zView * amp * sin(ph * 6.2831853));
        }`,
      );
  };
  material.customProgramCacheKey = () => `layers-${layerHeight}-${strength}`;
}

function makeBlobShadowTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 32, 4, 128, 32, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.setTransform(1, 0, 0, 0.25, 0, 24);
  ctx.fillRect(0, -96, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class LaFabrikViewer extends EventTarget {
  /**
   * @param {HTMLElement} container
   * @param {{ baseUrl?: string, tier?: 'high'|'medium'|'low', editMode?: boolean, background?: string }} [opts]
   */
  constructor(container, opts = {}) {
    super();
    this.container = container;
    this.opts = opts;
    this.baseUrl = opts.baseUrl ?? new URL('./', document.baseURI).href;
    this.tierName = opts.tier ?? detectTier();
    this.tier = TIERS[this.tierName];
    this.pieces = new Map();
    this.needsRender = true;
    this.tween = null;
    this.active = true;
    this._frameTimes = [];
    this._dpr = Math.min(window.devicePixelRatio || 1, this.tier.maxDpr);

    const renderer = new THREE.WebGLRenderer({ antialias: this.tier.antialias, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(this._dpr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.setAttribute('aria-label', 'Modèle 3D du cadre — faites glisser pour tourner, pincez ou molette pour zoomer');
    renderer.domElement.setAttribute('role', 'img');
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(opts.background ?? '#f3f3f1');
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentIntensity = 0.7;
    room.dispose();
    pmrem.dispose();
    this.scene = scene;

    // Lumière principale (douce, haut-gauche-avant) : ombres réelles des reliefs sur le fond.
    const key = new THREE.DirectionalLight('#ffffff', 2.0);
    key.position.set(-260, 420, 620);
    key.castShadow = true;
    key.shadow.mapSize.setScalar(this.tier.shadowMap);
    const sc = key.shadow.camera;
    sc.left = -260; sc.right = 260; sc.top = 260; sc.bottom = -260; sc.near = 200; sc.far = 1600;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.35;
    key.shadow.radius = 4;
    scene.add(key, key.target);
    this.keyLight = key;
    // Contre-jour léger pour détacher la silhouette et éclairer le dos.
    const rim = new THREE.DirectionalLight('#ffffff', 0.45);
    rim.position.set(400, 200, -600);
    scene.add(rim);

    this.camera = new THREE.PerspectiveCamera(28, 1, 5, 20000);
    const controls = new OrbitControls(this.camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.8;
    controls.screenSpacePanning = true;
    controls.autoRotateSpeed = 1.6;
    controls.minPolarAngle = 0.02;
    controls.maxPolarAngle = Math.PI - 0.02;
    controls.addEventListener('start', () => {
      this.cancelTween();
      if (controls.autoRotate) this.setAutoRotate(false);
      this.dispatchEvent(new Event('interact'));
    });
    controls.addEventListener('change', () => { this.clampTarget(); this.requestRender(); });
    this.controls = controls;

    this.root = new THREE.Group();
    this.root.name = 'lafabrik-product';
    scene.add(this.root);

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this.resize();
    this._clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.tick());
    this._onContextLost = (e) => { e.preventDefault(); this.dispatchEvent(new CustomEvent('error', { detail: new Error('Contexte WebGL perdu') })); };
    renderer.domElement.addEventListener('webglcontextlost', this._onContextLost);
  }

  // ---------------------------------------------------------------- chargement
  url(rel, base = this.productBase) {
    return new URL(rel, base ?? this.baseUrl).href;
  }

  async load(configUrl) {
    const t0 = performance.now();
    const progress = (p, label) => this.dispatchEvent(new CustomEvent('progress', { detail: { p, label } }));
    progress(0.02, 'Configuration');
    const cfgAbs = new URL(configUrl, this.baseUrl).href;
    this.productBase = new URL('./', cfgAbs).href;
    const config = await (await fetch(cfgAbs)).json();
    this.config = config;
    const presetUrl = new URL(config.frame ?? 'shared/rodalm.json', new URL('../../', this.productBase)).href;
    this.preset = await (await fetch(presetUrl)).json();
    this.metrics = rodalmMetrics(this.preset);

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    loader.manager.onProgress = () => {};
    const frameUrl = presetUrl.replace(/\.json$/, '.glb');
    const bgName = config.background.variants?.[this.tier.texture] ?? config.background.src;

    progress(0.1, 'Cadre et fond');
    const [frame, bgTex, relief] = await Promise.all([
      loader.loadAsync(frameUrl).then((g) => g.scene).catch((e) => {
        console.warn('[LaFabrik] rodalm.glb indisponible, génération paramétrique', e);
        return buildRodalm(this.preset).group;
      }),
      new THREE.TextureLoader().loadAsync(this.url(bgName)).catch(() => new THREE.TextureLoader().loadAsync(this.url(config.background.src ?? 'background.webp'))),
      config.relief?.src ? loader.loadAsync(this.url(config.relief.src)).then((g) => g.scene) : Promise.resolve(null),
    ]);
    progress(0.85, 'Assemblage');

    this.root.clear();
    this.setupFrame(frame);
    this.setupBackground(bgTex);
    if (relief) this.setupRelief(relief);
    this.setupGround();
    this.setGlassVisible(config.glass?.enabled !== false && config.glass?.visibleByDefault !== false);

    this.controls.minDistance = config.camera?.minDistanceMm ?? 140;
    this.controls.maxDistance = config.camera?.maxDistanceMm ?? 1500;
    VIEWS.initial = config.camera?.initial ?? { azimuthDeg: -22, elevationDeg: 8 };
    this.goTo('initial', { duration: 0 });
    if (config.camera?.autoRotate) this.setAutoRotate(true);

    // Compile les shaders avant la première image pour éviter un à-coup.
    await this.renderer.compileAsync?.(this.scene, this.camera);
    this.requestRender();
    this.loadTimeMs = Math.round(performance.now() - t0);
    progress(1, 'Prêt');
    this.dispatchEvent(new CustomEvent('ready', { detail: { config, loadTimeMs: this.loadTimeMs, tier: this.tierName } }));
    return this;
  }

  setupFrame(frame) {
    const p = this.preset;
    this.frame = frame;
    this.frame.name = 'rodalm';
    frame.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const n = o.name;
      if (n.startsWith('frame_')) {
        o.material.color.set(p.material.color);
        o.material.roughness = p.material.roughness;
        o.material.metalness = p.material.metalness ?? 0;
      } else if (n === 'back_panel') {
        o.material.color.set(p.back.color);
        o.material.roughness = p.back.roughness ?? 0.85;
      } else if (n === 'glass' || o.material.name === 'rodalm_glass') {
        o.castShadow = false;
        o.receiveShadow = false;
        o.renderOrder = 10;
        o.material = new THREE.MeshPhysicalMaterial({
          name: 'glass',
          color: '#ffffff',
          roughness: 0.02,
          metalness: 0,
          transparent: true,
          opacity: p.glass.opacity ?? 0.06,
          envMapIntensity: 1.6,
          specularIntensity: 1,
          ior: 1.57,
          depthWrite: false,
        });
        this.glass = o;
      }
    });
    this.root.add(frame);
  }

  setupBackground(tex) {
    const bg = this.config.background;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const mat = new THREE.MeshStandardMaterial({ name: 'background', map: tex, roughness: bg.roughness ?? 0.88, metalness: 0 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.name = 'background';
    mesh.receiveShadow = true;
    this.background = mesh;
    this.applyBackground(bg);
    this.root.add(mesh);
  }

  /** Position/échelle du fond — le PNG n'est jamais étiré : seules ses cotes en mm comptent. */
  applyBackground(bg) {
    this.config.background = bg;
    const m = this.background;
    m.scale.set(bg.widthMm, bg.heightMm, 1);
    m.position.set(bg.offsetMm?.[0] ?? 0, bg.offsetMm?.[1] ?? 0, 0.02);
    m.rotation.z = (bg.rotationDeg ?? 0) * DEG;
    this.requestRender();
  }

  filamentMaterial(index, override) {
    const f = { ...(this.config.filaments?.[String(index)] ?? { color: '#cccccc', finish: 'matte' }), ...(override ?? {}) };
    const fin = FINISHES[f.finish] ?? FINISHES.matte;
    const mat = new THREE.MeshStandardMaterial({
      name: `filament_${index}`,
      color: new THREE.Color(f.color),
      roughness: f.roughness ?? fin.roughness,
      metalness: f.metalness ?? fin.metalness,
    });
    if (this.tier.layerLines && f.layerLines !== false) addLayerLines(mat, f.layerHeight ?? 0.2);
    return mat;
  }

  setupRelief(reliefScene) {
    this.reliefGroup = new THREE.Group();
    this.reliefGroup.name = 'relief';
    this.root.add(this.reliefGroup);
    const byId = new Map();
    reliefScene.traverse((o) => { if (o.name && !o.isMesh && o !== reliefScene) byId.set(o.name, o); });
    for (const pc of this.config.relief.pieces ?? []) {
      const src = byId.get(pc.id);
      if (!src) { console.warn(`[LaFabrik] pièce « ${pc.id} » absente de relief.glb`); continue; }
      // Enveloppe dédiée : la transformation de la node GLB (déquantification meshopt) est conservée.
      const wrapper = new THREE.Group();
      wrapper.name = `piece:${pc.id}`;
      wrapper.userData.pieceId = pc.id;
      src.parent?.remove(src);
      wrapper.add(src);
      src.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.userData.pieceId = pc.id;
        o.userData.filament = o.material.name?.startsWith('filament_') ? o.material.name.slice(9) : null;
        o.userData.sourceColor = o.material.color?.getHexString();
      });
      this.reliefGroup.add(wrapper);
      this.pieces.set(pc.id, { config: pc, object: wrapper });
      this.applyPiece(pc);
    }
  }

  /** Applique position (mm), rotation (°), échelle, visibilité et matériaux d'une pièce. */
  applyPiece(pc) {
    const entry = this.pieces.get(pc.id);
    if (!entry) return;
    entry.config = pc;
    const o = entry.object;
    const [x, y, z] = pc.positionMm ?? [0, 0, 0];
    o.position.set(x, y, z);
    const [rx, ry, rz] = pc.rotationDeg ?? [0, 0, 0];
    o.rotation.set(rx * DEG, ry * DEG, rz * DEG);
    const s = pc.scale ?? [1, 1, 1];
    o.scale.set(...(Array.isArray(s) ? s : [s, s, s]));
    o.visible = pc.visible !== false;
    // Matériaux recréés seulement si la couleur / finition a changé (glissières fluides en édition).
    const matKey = JSON.stringify([pc.material ?? null, this.config.filaments ?? null]);
    if (entry.matKey === matKey) { this.requestRender(); return; }
    entry.matKey = matKey;
    o.traverse((m) => {
      if (!m.isMesh) return;
      const fil = m.userData.filament;
      const old = m.material;
      m.material = fil
        ? this.filamentMaterial(fil, pc.material)
        : this.filamentMaterial('x', { color: `#${m.userData.sourceColor}`, ...(pc.material ?? {}) });
      if (old !== m.material) old.dispose?.();
    });
    this.requestRender();
  }

  setupGround() {
    const { W, D } = this.metrics;
    const mat = new THREE.MeshBasicMaterial({ map: makeBlobShadowTexture(), transparent: true, depthWrite: false, toneMapped: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.6, Math.max(D * 5, 150)), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, -this.metrics.H / 2 - 0.6, this.metrics.z.front - D / 2);
    plane.name = 'contact-shadow';
    plane.renderOrder = -1;
    this.root.add(plane);
  }

  // ----------------------------------------------------------------- caméra
  get frameCenter() {
    return new THREE.Vector3(0, 0, this.metrics ? (this.metrics.z.front + this.metrics.z.rear) / 2 : 0);
  }

  fitDistance() {
    if (!this.metrics) return 800;
    const fill = this.config?.camera?.fill ?? 0.84;
    const vfov = this.camera.fov * DEG;
    const tanV = Math.tan(vfov / 2);
    const tanH = tanV * this.camera.aspect;
    const dV = this.metrics.H / 2 / tanV / fill;
    const dH = this.metrics.W / 2 / tanH / fill;
    return Math.max(dV, dH) + this.metrics.D / 2;
  }

  viewPose(name) {
    const v = typeof name === 'string' ? VIEWS[name] : name;
    return { azimuth: (v?.azimuthDeg ?? 0) * DEG, elevation: (v?.elevationDeg ?? 0) * DEG, distance: v?.distanceMm ?? this.fitDistance() };
  }

  /** Anime la caméra vers une vue nommée ('initial', 'front', 'side', 'back') ou {azimuthDeg, elevationDeg}. */
  goTo(name, { duration = 750 } = {}) {
    const target = this.viewPose(name);
    const c = this.controls;
    const offset = new THREE.Vector3().subVectors(this.camera.position, c.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    const from = { azimuth: sph.theta, elevation: Math.PI / 2 - sph.phi, distance: sph.radius || target.distance, target: c.target.clone() };
    const to = { ...target, azimuth: shortestAngle(from.azimuth, target.azimuth), target: this.frameCenter };
    this.currentView = typeof name === 'string' ? name : 'custom';
    if (!duration) {
      this.applyPose(to);
      return;
    }
    this.tween = { from, to, t0: performance.now(), duration };
    this.requestRender();
  }

  applyPose(p) {
    const c = this.controls;
    c.target.copy(p.target);
    const phi = Math.PI / 2 - p.elevation;
    this.camera.position.setFromSpherical(new THREE.Spherical(p.distance, phi, p.azimuth)).add(p.target);
    this.camera.lookAt(p.target);
    c.update();
    this.requestRender();
  }

  cancelTween() { this.tween = null; }

  recenter() { this.goTo(this.currentView && this.currentView !== 'custom' ? this.currentView : 'initial'); }

  /** Empêche le panoramique de perdre le cadre hors champ. */
  clampTarget() {
    if (!this.metrics) return;
    const t = this.controls.target;
    const lim = { x: this.metrics.W / 2, y: this.metrics.H / 2, z: this.metrics.D };
    const clamped = new THREE.Vector3(
      THREE.MathUtils.clamp(t.x, -lim.x, lim.x),
      THREE.MathUtils.clamp(t.y, -lim.y, lim.y),
      THREE.MathUtils.clamp(t.z, -lim.z, lim.z),
    );
    if (!clamped.equals(t)) {
      const d = clamped.clone().sub(t);
      t.add(d);
      this.camera.position.add(d);
    }
  }

  setAutoRotate(on) {
    this.controls.autoRotate = !!on;
    this.dispatchEvent(new CustomEvent('autorotate', { detail: !!on }));
    this.requestRender();
  }

  setGlassVisible(on) {
    if (this.glass) this.glass.visible = !!on && this.config?.glass?.enabled !== false;
    this.dispatchEvent(new CustomEvent('glass', { detail: this.glass?.visible ?? false }));
    this.requestRender();
  }

  // ---------------------------------------------------------------- rendu
  requestRender() { this.needsRender = true; }

  setActive(on) {
    this.active = on;
    if (on) this.requestRender();
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    const prevFit = this.metrics ? this.fitDistance() : null;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (prevFit && !this.tween) {
      // conserve le cadrage relatif lors d'un passage plein écran / rotation d'écran
      const ratio = this.fitDistance() / prevFit;
      const off = this.camera.position.clone().sub(this.controls.target).multiplyScalar(ratio);
      this.camera.position.copy(this.controls.target).add(off);
    }
    this.requestRender();
  }

  tick() {
    const dt = this._clock.getDelta();
    if (!this.active) return;
    if (this.tween) {
      const { from, to, t0, duration } = this.tween;
      const k = Math.min(1, (performance.now() - t0) / duration);
      const e = easeInOutCubic(k);
      this.applyPose({
        azimuth: from.azimuth + (to.azimuth - from.azimuth) * e,
        elevation: from.elevation + (to.elevation - from.elevation) * e,
        distance: from.distance + (to.distance - from.distance) * e,
        target: from.target.clone().lerp(to.target, e),
      });
      if (k >= 1) this.tween = null;
    }
    const moved = this.controls.update(dt);
    if (!moved && !this.needsRender) return;
    this.needsRender = false;
    this.updateClipping();
    const t = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.adapt(performance.now() - t, dt);
  }

  /** Plans de découpe serrés autour du cadre : précision de profondeur maximale (tampons 16 bits sur certains mobiles). */
  updateClipping() {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const near = Math.max(2, dist - 450);
    if (Math.abs(near - this.camera.near) > 1) {
      this.camera.near = near;
      this.camera.far = dist + 1200;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Qualité adaptative : si l'appareil peine, on baisse la résolution de rendu. */
  adapt(cpuMs, dt) {
    if (dt <= 0 || dt > 0.5) return;
    this._frameTimes.push(dt);
    if (this._frameTimes.length < 40) return;
    const avg = this._frameTimes.reduce((a, b) => a + b, 0) / this._frameTimes.length;
    this._frameTimes.length = 0;
    if (avg > 1 / 40 && this._dpr > 1) {
      this._dpr = Math.max(1, this._dpr - 0.25);
      this.renderer.setPixelRatio(this._dpr);
      this.resize();
      this.dispatchEvent(new CustomEvent('quality', { detail: { dpr: this._dpr } }));
    }
  }

  /** Capture l'image courante (aperçu / comparaison photo). */
  snapshot(type = 'image/webp', quality = 0.9) {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL(type, quality);
  }

  pickPiece(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.reliefGroup ?? new THREE.Group(), true)[0];
    return hit?.object.userData.pieceId ?? null;
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this._ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) { m.map?.dispose(); m.dispose(); }
    });
    this.scene.environment?.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this._onContextLost);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
