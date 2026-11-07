// Construit le composant autonome à héberger sur la boutique :
//   dist/embed/lafabrik-viewer.js (+ chunk du moteur 3D chargé à la demande)
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/embed',
    target: ['es2022', 'safari15', 'chrome100', 'firefox100'],
    emptyOutDir: true,
    lib: { entry: resolve(__dirname, 'src/embed/lafabrik-viewer.js'), formats: ['es'], fileName: () => 'lafabrik-viewer.js' },
    rollupOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].js' } },
  },
});
