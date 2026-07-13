// Sanity checks for the dashboard + worker. Run: node scripts/check.mjs
import fs from 'node:fs';
let failed = 0;
const fail = m => { console.error('✗ ' + m); failed = 1; };
const ok = m => console.log('✓ ' + m);

// ---- index.html: inline script must parse ----
const html = fs.readFileSync('index.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
if (!m) fail('index.html: inline <script> block not found');
else {
  try { new Function(m[1]); ok('index.html JS parses'); }
  catch (e) { fail('index.html JS parse error: ' + e.message); }
}

// ---- i18n: every used key exists in BOTH en and th ----
try {
  const dictSrc = html.match(/const I18N=(\{[\s\S]*?\n\});/)[1];
  const I18N = new Function('return ' + dictSrc)();
  const used = new Set();
  [...html.matchAll(/data-i18n(?:-ph|-aria)?="([^"]+)"/g)].forEach(x => used.add(x[1]));
  [...html.matchAll(/\bt\('([^']+)'\)/g)].forEach(x => used.add(x[1]));
  const missing = { en: [], th: [] };
  for (const k of used) {
    if (k.startsWith('r_')) continue; // range labels checked below
    if (!(k in I18N.en)) missing.en.push(k);
    if (!(k in I18N.th)) missing.th.push(k);
  }
  ['r_d1','r_w1','r_d15','r_m1'].forEach(k => { if (!(k in I18N.en)) missing.en.push(k); if (!(k in I18N.th)) missing.th.push(k); });
  const parity = Object.keys(I18N.en).filter(k => !(k in I18N.th));
  if (missing.en.length) fail('i18n keys missing in en: ' + missing.en.join(', '));
  if (missing.th.length) fail('i18n keys missing in th: ' + missing.th.join(', '));
  if (parity.length) fail('en keys without th translation: ' + parity.join(', '));
  if (!missing.en.length && !missing.th.length && !parity.length) ok(`i18n: ${used.size} used keys resolve in both languages`);
} catch (e) { fail('i18n check error: ' + e.message); }

// ---- worker parses ----
try {
  const w = fs.readFileSync('worker/nav-sync/index.js', 'utf8');
  new Function(w.replace('export default', 'const _default ='));
  ok('worker/nav-sync/index.js parses');
} catch (e) { fail('worker parse error: ' + e.message); }

process.exit(failed);
