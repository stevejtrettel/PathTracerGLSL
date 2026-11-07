// Downloads the trial assets listed in tools/trial-assets.json from Poly Haven (CC0) into
// public/trial/<kind>/, checking each file against the MD5 the Poly Haven files API publishes.
// Files already present with the right MD5 are skipped. Usage: node tools/fetch-trial-assets.mjs
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { assets } = JSON.parse(readFileSync(join(root, 'tools/trial-assets.json'), 'utf8'));
const md5 = (buf) => createHash('md5').update(buf).digest('hex');

for (const a of assets) {
    const files = await (await fetch(`https://api.polyhaven.com/files/${a.id}`)).json();
    const entry = files[a.kind]?.[a.res]?.[a.format];
    if (!entry) throw new Error(`${a.id}: no ${a.kind} ${a.res} ${a.format} on Poly Haven`);
    const out = join(root, 'public/trial', a.kind, `${a.id}_${a.res}.${a.format}`);
    if (existsSync(out) && md5(readFileSync(out)) === entry.md5) { console.log(`ok   ${out}`); continue; }
    const buf = Buffer.from(await (await fetch(entry.url)).arrayBuffer());
    if (md5(buf) !== entry.md5) throw new Error(`${a.id}: MD5 mismatch`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buf);
    console.log(`got  ${out} (${(buf.length / 1e6).toFixed(1)} MB)`);
}
