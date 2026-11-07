import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { prettyJson } from './tools/lib/json.mjs';

// Enregistrement des configurations depuis le mode édition (serveur de développement uniquement :
// rien de tel n'existe dans la version publiée).
function editorSavePlugin() {
  return {
    name: 'lafabrik-editor-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__lafabrik/save', (req, res) => {
        const id = decodeURIComponent((req.url || '').replace(/^\//, ''));
        if (req.method !== 'POST' || !/^[a-z0-9-]+$/.test(id)) { res.statusCode = 400; return res.end('requête invalide'); }
        const file = resolve(__dirname, 'public/products', id, 'config.json');
        if (!existsSync(file)) { res.statusCode = 404; return res.end('produit inconnu'); }
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
        req.on('end', async () => {
          try {
            const cfg = JSON.parse(body);
            if (cfg.id !== id) throw new Error('id incohérent');
            await writeFile(file, prettyJson(cfg));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file: `public/products/${id}/config.json` }));
          } catch (e) { res.statusCode = 400; res.end(String(e.message)); }
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [editorSavePlugin()],
  server: { host: true, port: 5173 },
  build: {
    outDir: 'dist/site',
    chunkSizeWarningLimit: 900,
    target: ['es2022', 'safari15', 'chrome100', 'firefox100'],
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html'),
        fiche: resolve(__dirname, 'demo-fiche-produit.html'),
      },
    },
  },
});
