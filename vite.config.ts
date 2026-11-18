import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
 * Purdue GenAI Studio (3.0). The browser calls /genai/...; this server forwards to
 * GenAI Studio and adds the API key, so the key stays on this computer and out of the
 * browser. Put it in .env.local (git-ignored):  GENAI_API_KEY=sk-...
 * GENAI_URL overrides the address (default https://genai.rcac.purdue.edu).
 */
function genaiProxy(env: Record<string, string>): Record<string, ProxyOptions> {
  const key = env.GENAI_API_KEY || process.env.GENAI_API_KEY || '';
  return {
    '/genai': {
      target: env.GENAI_URL || process.env.GENAI_URL || 'https://genai.rcac.purdue.edu',
      changeOrigin: true,
      secure: true,
      rewrite: (p: string) => p.replace(/^\/genai/, ''),
      configure: (proxy) => {
        proxy.on('proxyReq', (req) => {
          req.removeHeader('origin');
          req.removeHeader('cookie');
          if (key) req.setHeader('Authorization', `Bearer ${key}`);
        });
      },
    },
  };
}

/**
 * OpenCode (3.1). The browser calls /opencode/...; this server forwards to a local
 * `opencode serve` (OpenCode 2, default http://127.0.0.1:4096) and adds what OpenCode 2
 * needs: its server password (HTTP basic, user "opencode") and the folder it works in.
 * From .env.local: OPENCODE_SERVER_PASSWORD, and optionally OPENCODE_URL and
 * OPENCODE_DIRECTORY (default ~/ink2web-opencode).
 */
function opencodeProxy(env: Record<string, string>): Record<string, ProxyOptions> {
  const pick = (k: string) => env[k] || process.env[k] || '';
  const password = pick('OPENCODE_SERVER_PASSWORD');
  const user = pick('OPENCODE_SERVER_USERNAME') || 'opencode';
  const dir = pick('OPENCODE_DIRECTORY') || path.join(os.homedir(), 'ink2web-opencode');
  return {
    '/opencode': {
      target: pick('OPENCODE_URL') || 'http://127.0.0.1:4096',
      changeOrigin: true,
      timeout: 600_000,
      proxyTimeout: 600_000,
      rewrite: (p: string) => p.replace(/^\/opencode/, ''),
      configure: (proxy) => {
        proxy.on('proxyReq', (req) => {
          req.removeHeader('origin');
          req.removeHeader('cookie');
          req.setHeader('x-opencode-directory', dir);
          if (password) req.setHeader('Authorization', `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`);
        });
      },
    },
  };
}

const requireFrom = createRequire(import.meta.url);

/**
 * Serves pdf.js's wasm decoders and ICC profiles at /pdfjs/{wasm,iccs}/ in dev,
 * and copies them into dist/ on build (pdf.js fetches them by exact file name,
 * so they must not be hashed).
 */
function pdfjsAssets(): Plugin {
  const root = path.dirname(requireFrom.resolve('pdfjs-dist/package.json'));
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

/**
 * The preview's MathJax loads the mathtools extension from next to its own script.
 * In a build that script lives in assets/, so copy the extension there (dev serves
 * it straight from node_modules).
 */
function mathjaxExtensions(): Plugin {
  const es5 = path.join(path.dirname(requireFrom.resolve('mathjax/package.json')), 'es5');
  const files = ['input/tex/extensions/mathtools.js'];
  return {
    name: 'mathjax-extensions',
    generateBundle() {
      for (const f of files) {
        const src = path.join(es5, f);
        if (fs.existsSync(src)) this.emitFile({ type: 'asset', fileName: `assets/${f}`, source: fs.readFileSync(src) });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // '' = read every variable in .env / .env.local, not only VITE_ ones. Nothing here is
  // exposed to the browser: only the proxy uses it.
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = { ...ollamaProxy, ...genaiProxy(env), ...opencodeProxy(env) };
  return {
    plugins: [react(), pdfjsAssets(), mathjaxExtensions()],
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
  };
});
