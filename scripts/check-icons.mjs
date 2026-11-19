// Validates the icon package and its integration. Usage: node scripts/check-icons.mjs   (run `npm run build` first)
//  1. every icon file exists, PNGs are real PNGs of the declared size, Apple icons are opaque, ICO holds 16/32/48
//  2. SVG is well-formed XML, manifest is valid JSON and every icon it lists exists with matching size/type
//  3. dist/ is served under "/" and under a sub-path ("/ToonBridge/"); every URL in index.html + manifest must return 200
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (m) => console.log('  ok  ', m);
const bad = (m) => { fails++; console.log('  FAIL', m); };
const check = (c, m) => (c ? ok(m) : bad(m));

const EXPECT = {
  'icon-master.png': 1024, 'icon-512.png': 512, 'icon-192.png': 192, 'icon-maskable-512.png': 512,
  'apple-touch-icon.png': 180, 'apple-touch-icon-167.png': 167, 'apple-touch-icon-152.png': 152,
  'favicon-32x32.png': 32, 'favicon-16x16.png': 16,
};
const APPLE = ['apple-touch-icon.png', 'apple-touch-icon-167.png', 'apple-touch-icon-152.png'];

function png(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((v, i) => buf[i] === v)) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25] };
}

for (const dir of ['public', 'dist']) {
  if (!existsSync(join(root, dir))) { bad(`${dir}/ missing${dir === 'dist' ? ' (run npm run build)' : ''}`); continue; }
  console.log(`\n[${dir}/ files]`);
  for (const [name, size] of Object.entries(EXPECT)) {
    const p = join(root, dir, name);
    if (!existsSync(p)) { bad(`${name} missing`); continue; }
    const info = png(readFileSync(p));
    if (!info) { bad(`${name} is not a PNG`); continue; }
    check(info.w === size && info.h === size, `${name} is a real PNG, ${info.w}×${info.h} (expected ${size}×${size})`);
    if (APPLE.includes(name)) check(info.colorType === 2, `${name} has no alpha channel (color type ${info.colorType})`);
  }
  // ICO
  const icoP = join(root, dir, 'favicon.ico');
  if (!existsSync(icoP)) bad('favicon.ico missing');
  else {
    const b = readFileSync(icoP);
    const n = b.readUInt16LE(4);
    const sizes = [];
    let valid = b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1;
    for (let i = 0; i < n; i++) {
      const o = 6 + i * 16, w = b[o] || 256, len = b.readUInt32LE(o + 8), off = b.readUInt32LE(o + 12);
      const inner = png(b.subarray(off, off + len));
      if (!inner || inner.w !== w) valid = false;
      sizes.push(w);
    }
    check(valid && sizes.join() === '16,32,48', `favicon.ico valid, contains ${sizes.join('+')} px images`);
  }
  // SVG
  const svgP = join(root, dir, 'favicon.svg');
  if (!existsSync(svgP)) bad('favicon.svg missing');
  else {
    const t = readFileSync(svgP, 'utf8');
    const v = XMLValidator.validate(t);
    const doc = new XMLParser({ ignoreAttributes: false }).parse(t);
    check(v === true && doc.svg?.['@_viewBox'], `favicon.svg is well-formed XML with a viewBox (${(t.length / 1024).toFixed(1)} KB)`);
  }
  // manifest
  const mP = join(root, dir, 'manifest.webmanifest');
  if (!existsSync(mP)) { bad('manifest.webmanifest missing'); continue; }
  let m;
  try { m = JSON.parse(readFileSync(mP, 'utf8')); ok('manifest.webmanifest is valid JSON'); } catch (e) { bad('manifest invalid JSON: ' + e.message); continue; }
  for (const k of ['name', 'short_name', 'description', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'orientation', 'icons']) check(m[k] !== undefined, `manifest.${k} present`);
  check(m.display === 'standalone', 'manifest.display = standalone');
  const purposes = (m.icons || []).map((i) => i.purpose);
  check(purposes.includes('any') && purposes.includes('maskable'), 'manifest has "any" and "maskable" icons');
  for (const i of m.icons || []) {
    const f = join(root, dir, i.src.split('?')[0]);
    const info = existsSync(f) ? png(readFileSync(f)) : null;
    check(!!info && `${info.w}x${info.h}` === i.sizes && i.type === 'image/png', `manifest icon ${i.src} → ${info ? info.w + 'x' + info.h : 'MISSING'} matches "${i.sizes}" / ${i.type} / ${i.purpose}`);
  }
}

// ---- serve dist under several prefixes and request every referenced URL ----
const MIME = { '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
function serve(prefix) {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (!u.pathname.startsWith(prefix)) { res.writeHead(404); return res.end(); }
      let rel = decodeURIComponent(u.pathname.slice(prefix.length)) || 'index.html';
      if (rel.endsWith('/')) rel += 'index.html';
      const f = join(root, 'dist', rel);
      if (!f.startsWith(join(root, 'dist')) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
      createReadStream(f).pipe(res);
    }).listen(0, () => resolve(s));
  });
}
if (existsSync(join(root, 'dist/index.html'))) {
  for (const prefix of ['/', '/ToonBridge/']) {
    console.log(`\n[HTTP check, dist served at ${prefix}]`);
    const s = await serve(prefix);
    const origin = `http://127.0.0.1:${s.address().port}`;
    const page = origin + prefix;
    const html = await (await fetch(page)).text();
    const urls = new Set();
    for (const m of html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)) urls.add(new URL(m[1], page).href);
    for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) urls.add(new URL(m[1], page).href);
    const mHref = [...urls].find((u) => u.includes('manifest.webmanifest'));
    if (!mHref) bad('index.html has no manifest link');
    else {
      const mr = await fetch(mHref);
      check((mr.headers.get('content-type') || '').includes('manifest+json'), 'manifest served as application/manifest+json');
      const mj = await mr.json();
      for (const i of mj.icons) urls.add(new URL(i.src, mHref).href);
      urls.add(new URL(mj.start_url, mHref).href);
    }
    for (const u of urls) {
      const r = await fetch(u);
      check(r.status === 200, `${r.status} ${u.replace(origin, '')}`);
    }
    s.close();
  }
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll icon checks passed');
process.exit(fails ? 1 : 0);
