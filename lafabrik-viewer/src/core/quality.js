// Niveaux de qualité selon l'appareil. Le moteur abaisse ensuite la résolution
// de rendu en direct si la fluidité descend sous ~40 i/s (voir LaFabrikViewer.adapt).
export const TIERS = {
  high: { maxDpr: 2, shadowMap: 2048, texture: 'high', antialias: true, layerLines: true },
  medium: { maxDpr: 2, shadowMap: 2048, texture: 'low', antialias: true, layerLines: true },
  low: { maxDpr: 1.25, shadowMap: 1024, texture: 'low', antialias: false, layerLines: false },
};

export function detectTier() {
  if (typeof navigator === 'undefined') return 'high';
  const q = new URLSearchParams(location.search).get('quality');
  if (q && TIERS[q]) return q;
  const mem = navigator.deviceMemory ?? 8; // non exposé par Safari
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = matchMedia?.('(pointer: coarse)').matches;
  const saveData = navigator.connection?.saveData === true;
  if (saveData || mem <= 2 || cores <= 2) return 'low';
  if (coarse || mem <= 4) return 'medium';
  return 'high';
}

/** Vérifie la disponibilité de WebGL 2 (requis : Safari ≥ 15, Chrome/Android récents). */
export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}
