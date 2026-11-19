import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Cache-busting for icons. Hosts like GitHub Pages cache static files for ~10 minutes and browsers cache favicons very
 * aggressively, so after every build the icon/manifest URLs get `?v=<hash of the icon files>`. Change an icon -> the hash
 * changes -> browsers fetch the new file. (Dev server keeps plain URLs.)
 */
function iconVersioning(): Plugin {
  const ICON = /^(favicon|apple-touch-icon|icon-)/;
  let outDir = 'dist', publicDir = 'public';
  const hash = () => {
    const h = createHash('sha1');
    for (const f of readdirSync(publicDir).filter((n) => ICON.test(n) || n === 'manifest.webmanifest').sort()) h.update(f).update(readFileSync(join(publicDir, f)));
    return h.digest('hex').slice(0, 8);
  };
  return {
    name: 'icon-versioning',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; publicDir = c.publicDir; },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const v = hash();
        return html.replace(/(<link\b[^>]*\bhref=")([^"]*?(?:favicon[^"]*|apple-touch-icon[^"]*|manifest\.webmanifest))(")/g, (_m, a, url, z) => `${a}${url}?v=${v}${z}`);
      },
    },
    closeBundle() {
      const p = join(outDir, 'manifest.webmanifest');
      if (!existsSync(p)) return;
      const v = hash();
      const m = JSON.parse(readFileSync(p, 'utf8'));
      for (const i of m.icons ?? []) i.src = `${i.src.split('?')[0]}?v=${v}`;
      writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
    },
  };
}

// base './' keeps the build relocatable (GitHub Pages sub-path, Netlify root).
export default defineConfig({
  base: './',
  plugins: [react(), iconVersioning()],
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 300000 },
});
