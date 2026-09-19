import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

const MANIFEST_SOURCE = path.resolve(__dirname, 'outlook/manifest.xml');
/** Where the Outlook manifest is published on the app origin (root path kept for existing sideloads). */
const MANIFEST_PATHS = ['/manifest.xml', '/outlook/manifest.xml'];

/**
 * Publishes outlook/manifest.xml (the single source of truth) at both manifest
 * paths: served straight from source in dev, emitted into dist/ on build.
 */
function outlookManifest(): Plugin {
  return {
    name: 'outlook-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (!MANIFEST_PATHS.includes(url)) return next();
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(fs.readFileSync(MANIFEST_SOURCE));
      });
    },
    generateBundle() {
      const source = fs.readFileSync(MANIFEST_SOURCE);
      for (const p of MANIFEST_PATHS) this.emitFile({ type: 'asset', fileName: p.slice(1), source });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), outlookManifest()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // Multi-page: the main app plus the Outlook add-in task pane / command pages.
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          taskpane: path.resolve(__dirname, 'outlook/taskpane.html'),
          commands: path.resolve(__dirname, 'outlook/commands.html'),
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
