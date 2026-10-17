import { defineConfig, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// Ollama listens on 127.0.0.1:11434. The dev server proxies /ollama -> Ollama so the
// browser never makes a cross-origin request (no OLLAMA_ORIGINS setup needed).
// Override the target with OLLAMA_HOST, e.g. OLLAMA_HOST=http://192.168.1.20:11434 npm run dev
const target = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

const ollamaProxy: Record<string, ProxyOptions> = {
  '/ollama': {
    target,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/ollama/, ''),
    configure: (proxy) => {
      // Requests without an Origin header are not subject to Ollama's CORS allow-list.
      proxy.on('proxyReq', (req) => req.removeHeader('origin'));
    },
  },
};

/**
 * Serves pdf.js's wasm decoders and ICC profiles at /pdfjs/{wasm,iccs}/ in dev,
 * and copies them into dist/ on build (pdf.js fetches them by exact file name,
 * so they must not be hashed).
 */
function pdfjsAssets(): Plugin {
  const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const dirs = ['wasm', 'iccs'];
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const [dir, ...rest] = rel.split('/');
        const file = path.join(root, dir, ...rest);
        if (!dirs.includes(dir) || !file.startsWith(path.join(root, dir)) || !fs.existsSync(file)) return next();
        if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const dir of dirs) {
        const full = path.join(root, dir);
        if (!fs.existsSync(full)) continue;
        for (const name of fs.readdirSync(full)) {
          if (name.startsWith('LICENSE')) continue;
          this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source: fs.readFileSync(path.join(full, name)) });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  server: { port: 5173, proxy: ollamaProxy },
  preview: { port: 4173, proxy: ollamaProxy },
});
