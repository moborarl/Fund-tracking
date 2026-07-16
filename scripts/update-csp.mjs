// Recompute the CSP sha256 hash for the inline <script> in index.html.
// Run after ANY change to the inline script: node scripts/update-csp.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
const p = 'index.html';
let html = fs.readFileSync(p, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
if (!m) { console.error('inline script not found'); process.exit(1); }
const hash = crypto.createHash('sha256').update(m[1], 'utf8').digest('base64');
const token = html.match(/'sha256-([A-Za-z0-9+/=]+)'/);
if (!token) { console.error('CSP sha256 token not found in meta tag'); process.exit(1); }
if (token[1] === hash) { console.log('CSP hash already up to date (sha256-' + hash + ')'); process.exit(0); }
html = html.replace(/'sha256-[A-Za-z0-9+/=]+'/, `'sha256-${hash}'`);
fs.writeFileSync(p, html);
console.log('CSP hash updated to sha256-' + hash);
