/**
 * <lafabrik-viewer> — composant web autonome à intégrer dans une fiche produit.
 *
 *   <lafabrik-viewer
 *       src="products/marquez/config.json"      chemin de la config produit (relatif à base)
 *       base="https://cdn.exemple.fr/lafabrik/" racine des fichiers (défaut : page courante)
 *       poster="products/marquez/poster.webp"   image affichée avant le chargement 3D
 *       autoload                                 charge la 3D dès que le composant est visible
 *       alt="Cadre Márquez #93 en relief">
 *   </lafabrik-viewer>
 *
 * Le moteur Three.js (~170 Ko gzip) n'est téléchargé qu'au clic sur « Voir en 3D »
 * (ou à l'approche de l'écran avec `autoload`).
 */
import { hasWebGL } from '../core/quality.js';

const ICONS = {
  cube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z M4.3 7.6 12 12l7.7-4.4M12 12v9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  front: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3.5" width="12" height="17" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="8.5" y="6" width="7" height="12" fill="currentColor" opacity=".25"/></svg>',
  side: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="10" y="3.5" width="4" height="17" rx=".8" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3.5" width="12" height="17" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 8h6M12 8v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  recenter: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  rotate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  glass: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 13l5-5M10 16l7-7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".7"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

const STYLE = `
:host { display:block; position:relative; --lf-bg:#f3f3f1; --lf-fg:#111; --lf-radius:12px; aspect-ratio: var(--lf-aspect, 4 / 5); background:var(--lf-bg); border-radius:var(--lf-radius); overflow:hidden; font: 500 14px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color:var(--lf-fg); -webkit-tap-highlight-color: transparent; contain: content; }
:host([data-fs]) { position:fixed !important; inset:0; z-index:2147483000; width:100vw; height:100dvh; aspect-ratio:auto; border-radius:0; }
.stage { position:absolute; inset:0; }
.poster { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; transition:opacity .4s ease; pointer-events:none; }
:host([data-ready]) .poster { opacity:0; }
.cta { position:absolute; left:50%; bottom:20px; transform:translateX(-50%); display:flex; gap:8px; align-items:center; border:0; border-radius:999px; padding:12px 20px 12px 16px; background:#fff; color:var(--lf-fg); font:inherit; font-weight:600; box-shadow:0 1px 2px rgba(0,0,0,.08),0 4px 16px rgba(0,0,0,.10); cursor:pointer; }
.cta svg { width:22px; height:22px; }
.cta:focus-visible, .bar button:focus-visible { outline:2px solid #0058a3; outline-offset:2px; }
:host([data-loading]) .cta, :host([data-ready]) .cta, :host([data-nowebgl]) .cta { display:none; }
.progress { position:absolute; left:50%; bottom:34px; width:min(220px,60%); height:3px; transform:translateX(-50%); background:rgba(0,0,0,.08); border-radius:3px; overflow:hidden; display:none; }
.progress i { display:block; height:100%; width:0; background:var(--lf-fg); transition:width .25s ease; }
:host([data-loading]) .progress { display:block; }
.bar { position:absolute; left:50%; bottom:14px; transform:translateX(-50%); display:none; gap:4px; padding:4px; background:rgba(255,255,255,.92); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); border-radius:999px; box-shadow:0 1px 2px rgba(0,0,0,.06),0 4px 14px rgba(0,0,0,.08); }
:host([data-ready]) .bar { display:flex; }
.bar button { width:40px; height:40px; border:0; border-radius:50%; background:transparent; color:var(--lf-fg); display:grid; place-items:center; cursor:pointer; padding:0; }
.bar button svg { width:22px; height:22px; }
.bar button:hover { background:rgba(0,0,0,.05); }
.bar button[aria-pressed="true"] { background:var(--lf-fg); color:#fff; }
.bar .sep { width:1px; margin:8px 2px; background:rgba(0,0,0,.12); }
.hint { position:absolute; top:14px; left:50%; transform:translateX(-50%); padding:6px 12px; border-radius:999px; background:rgba(17,17,17,.72); color:#fff; font-size:12.5px; white-space:nowrap; pointer-events:none; opacity:0; transition:opacity .4s; }
:host([data-ready]) .hint.show { opacity:1; }
.close { position:absolute; top:12px; right:12px; width:40px; height:40px; border:0; border-radius:50%; background:#fff; box-shadow:0 2px 10px rgba(0,0,0,.12); display:none; place-items:center; cursor:pointer; }
.close svg { width:20px; height:20px; }
:host([data-fs]) .close { display:grid; }
.msg { position:absolute; left:16px; right:16px; bottom:16px; padding:10px 14px; background:#fff; border-radius:10px; font-size:13px; box-shadow:0 2px 10px rgba(0,0,0,.08); display:none; text-align:center; }
:host([data-nowebgl]) .msg, :host([data-error]) .msg { display:block; }
@media (max-width: 420px) { .bar button { width:38px; height:38px; } .bar .opt { display:none; } }
@media (prefers-reduced-motion: reduce) { .poster, .progress i { transition:none; } }
`;

export class LaFabrikViewerElement extends HTMLElement {
  static get observedAttributes() { return ['src']; }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style>
      <div class="stage" part="stage"></div>
      <img class="poster" part="poster" alt="" decoding="async">
      <button class="cta" part="cta" type="button">${ICONS.cube}<span>Voir en 3D</span></button>
      <div class="progress" role="progressbar" aria-label="Chargement du modèle 3D" aria-valuemin="0" aria-valuemax="100"><i></i></div>
      <div class="hint">Glissez pour tourner · pincez pour zoomer</div>
      <div class="bar" part="toolbar" role="toolbar" aria-label="Commandes de la vue 3D">
        <button type="button" data-view="front" title="Vue de face" aria-label="Vue de face">${ICONS.front}</button>
        <button type="button" data-view="side" title="Vue de profil" aria-label="Vue de profil">${ICONS.side}</button>
        <button type="button" data-view="back" title="Vue arrière" aria-label="Vue arrière">${ICONS.back}</button>
        <button type="button" data-act="recenter" title="Recentrer" aria-label="Recentrer">${ICONS.recenter}</button>
        <span class="sep"></span>
        <button type="button" class="opt" data-act="rotate" title="Rotation automatique" aria-label="Rotation automatique" aria-pressed="false">${ICONS.rotate}</button>
        <button type="button" class="opt" data-act="glass" title="Afficher / masquer la protection" aria-label="Protection transparente" aria-pressed="true">${ICONS.glass}</button>
        <button type="button" data-act="fullscreen" title="Plein écran" aria-label="Plein écran">${ICONS.fullscreen}</button>
      </div>
      <button class="close" type="button" aria-label="Fermer le plein écran">${ICONS.close}</button>
      <div class="msg" role="status"></div>`;
    this.$ = (s) => root.querySelector(s);
    this.$('.cta').addEventListener('click', () => this.activate());
    this.$('.close').addEventListener('click', () => this.toggleFullscreen(false));
    this.$('.bar').addEventListener('click', (e) => this.onToolbar(e));
    this._onKey = (e) => { if (e.key === 'Escape' && this.hasAttribute('data-fs')) this.toggleFullscreen(false); };
    this._onFsChange = () => { if (!document.fullscreenElement && this._nativeFs) { this._nativeFs = false; this.removeAttribute('data-fs'); } };
  }

  connectedCallback() {
    const poster = this.getAttribute('poster');
    const img = this.$('.poster');
    if (poster) {
      img.src = new URL(poster, this.base).href;
      img.alt = this.getAttribute('alt') ?? '';
      img.onerror = () => img.removeAttribute('src');
    }
    if (!hasWebGL()) {
      this.setAttribute('data-nowebgl', '');
      this.$('.msg').textContent = "La vue 3D n'est pas disponible sur cet appareil. Les photos du produit restent consultables.";
      return;
    }
    if (this.hasAttribute('autoload')) {
      this._io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) this.activate();
        if (this.viewer) this.viewer.setActive(entries.some((e) => e.isIntersecting));
      }, { rootMargin: '200px' });
      this._io.observe(this);
    }
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('fullscreenchange', this._onFsChange);
  }

  disconnectedCallback() {
    this._io?.disconnect();
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('fullscreenchange', this._onFsChange);
    this.viewer?.dispose();
    this.viewer = null;
    this._loading = null;
  }

  get base() { return new URL(this.getAttribute('base') ?? './', document.baseURI).href; }

  /** Charge et affiche le modèle 3D (idempotent). */
  activate() {
    if (this._loading) return this._loading;
    this.setAttribute('data-loading', '');
    const bar = this.$('.progress i');
    this._loading = (async () => {
      try {
        const { LaFabrikViewer } = await import('../core/viewer.js');
        const v = new LaFabrikViewer(this.$('.stage'), { baseUrl: this.base });
        this.viewer = v;
        v.addEventListener('progress', (e) => { bar.style.width = `${Math.round(e.detail.p * 100)}%`; });
        v.addEventListener('autorotate', (e) => this.$('[data-act="rotate"]').setAttribute('aria-pressed', String(e.detail)));
        v.addEventListener('glass', (e) => this.$('[data-act="glass"]').setAttribute('aria-pressed', String(e.detail)));
        v.addEventListener('interact', () => this.$('.hint').classList.remove('show'), { once: true });
        await v.load(this.getAttribute('src'));
        if (v.config.glass?.enabled === false) this.$('[data-act="glass"]').hidden = true;
        this.removeAttribute('data-loading');
        this.setAttribute('data-ready', '');
        const hint = this.$('.hint');
        hint.classList.add('show');
        setTimeout(() => hint.classList.remove('show'), 4000);
        // Pause du rendu quand la visionneuse sort de l'écran (batterie).
        if (!this._io) {
          this._io = new IntersectionObserver((entries) => v.setActive(entries.some((e) => e.isIntersecting)));
          this._io.observe(this);
        }
        this.dispatchEvent(new CustomEvent('ready', { detail: { viewer: v } }));
        return v;
      } catch (err) {
        console.error('[LaFabrik]', err);
        this.removeAttribute('data-loading');
        this.setAttribute('data-error', '');
        this.$('.msg').textContent = 'Impossible de charger la vue 3D. Réessayez plus tard.';
        this._loading = null;
        throw err;
      }
    })();
    return this._loading;
  }

  onToolbar(e) {
    const b = e.target.closest('button');
    if (!b || !this.viewer) return;
    const v = this.viewer;
    if (b.dataset.view) return v.goTo(b.dataset.view);
    switch (b.dataset.act) {
      case 'recenter': return v.goTo('initial');
      case 'rotate': return v.setAutoRotate(!v.controls.autoRotate);
      case 'glass': return v.setGlassVisible(!v.glass?.visible);
      case 'fullscreen': return this.toggleFullscreen();
    }
  }

  /** Plein écran natif si possible ; sinon (iPhone) plein écran simulé en CSS. */
  async toggleFullscreen(force) {
    const on = force ?? !this.hasAttribute('data-fs');
    if (on) {
      this.setAttribute('data-fs', '');
      if (this.requestFullscreen && document.fullscreenEnabled) {
        try { await this.requestFullscreen({ navigationUI: 'hide' }); this._nativeFs = true; } catch { /* repli CSS */ }
      }
      this._prevOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
    } else {
      this.removeAttribute('data-fs');
      if (document.fullscreenElement === this) await document.exitFullscreen().catch(() => {});
      this._nativeFs = false;
      document.documentElement.style.overflow = this._prevOverflow ?? '';
    }
    requestAnimationFrame(() => this.viewer?.resize());
  }
}

if (!customElements.get('lafabrik-viewer')) customElements.define('lafabrik-viewer', LaFabrikViewerElement);
