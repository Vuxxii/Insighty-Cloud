/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Emits sw.js at build time, stamped with a unique build id and the exact list of
 * built shell assets to precache (PRD §2.3: shell only, cache-busted per deploy). */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'insightyyy-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((f) => f.endsWith('.js') || f.endsWith('.css') || f.endsWith('.woff2'))
        .map((f) => `/${f}`);
      const precache = [
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
        ...assets,
      ];
      const template = readFileSync('src/sw.template.js', 'utf8');
      const source = template
        .replaceAll('__BUILD_ID__', JSON.stringify(String(Date.now())))
        .replaceAll('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerPlugin()],
  build: {
    target: 'es2022',
  },
  test: {
    // Node env by default: fake-indexeddb + Node's native Blob/structuredClone.
    // DOM-dependent tests opt into jsdom via a @vitest-environment docblock.
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    globals: false,
  },
});
