// Downloads the trial assets listed in tools/trial-assets.json from Poly Haven (CC0) into
// public/trial/, checking each file against the MD5 the Poly Haven files API publishes. Files
// already present with the right MD5 are skipped. Usage: node tools/fetch-trial-assets.mjs
//
// Layout:
//   hdri     public/trial/hdri/<id>_<res>.<format>
//   texture  public/trial/textures/<id>/<Poly Haven file name>, one file per listed map
//   model    public/trial/models/<id>/<id>_<res>.gltf with its .bin and textures/ at the paths
//            the .gltf names, then <id>.obj beside it (tools/gltf-to-obj.mjs)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertFile } from './gltf-to-obj.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const trial = join(root, 'public/trial');
const { assets } = JSON.parse(readFileSync(join(root, 'tools/trial-assets.json'), 'utf8'));
const md5 = (buf) => createHash('md5').update(buf).digest('hex');

/** The files of one asset: [{ out, url, md5 }], from the Poly Haven files API listing. */
function filesOf(a, listing) {
    const pick = (key, format) => {
        const entry = listing[key]?.[a.res]?.[format];
        if (!entry) throw new Error(`${a.id}: no ${key} ${a.res} ${format} on Poly Haven`);
        return entry;
    };
    if (a.kind === 'hdri') {
        const e = pick('hdri', a.format);
        return [{ out: join(trial, 'hdri', `${a.id}_${a.res}.${a.format}`), url: e.url, md5: e.md5 }];
    }
    if (a.kind === 'texture') {
        return a.maps.map((map) => {
            const e = pick(map, a.format);
            return { out: join(trial, 'textures', a.id, basename(new URL(e.url).pathname)), url: e.url, md5: e.md5 };
        });
    }
    if (a.kind === 'model') {
        const e = pick('gltf', 'gltf');
        const dir = join(trial, 'models', a.id);
        const files = [{ out: join(dir, basename(new URL(e.url).pathname)), url: e.url, md5: e.md5 }];
        for (const [rel, inc] of Object.entries(e.include)) {
            const out = normalize(join(dir, rel));
            if (!out.startsWith(dir + sep)) throw new Error(`${a.id}: include path '${rel}' leaves the model folder`);
            files.push({ out, url: inc.url, md5: inc.md5 });
        }
        return files;
    }
    throw new Error(`${a.id}: unknown kind '${a.kind}'`);
}

for (const a of assets) {
    const listing = await (await fetch(`https://api.polyhaven.com/files/${a.id}`)).json();
    const files = filesOf(a, listing);
    for (const file of files) {
        if (existsSync(file.out) && md5(readFileSync(file.out)) === file.md5) { console.log(`ok   ${file.out}`); continue; }
        const buf = Buffer.from(await (await fetch(file.url)).arrayBuffer());
        if (md5(buf) !== file.md5) throw new Error(`${a.id}: MD5 mismatch for ${file.url}`);
        mkdirSync(dirname(file.out), { recursive: true });
        writeFileSync(file.out, buf);
        console.log(`got  ${file.out} (${(buf.length / 1e6).toFixed(1)} MB)`);
    }
    if (a.kind === 'model') {
        const obj = join(dirname(files[0].out), `${a.id}.obj`);
        const { textures } = convertFile(files[0].out, obj);
        console.log(`obj  ${obj}  ${Object.entries(textures).map(([role, uri]) => `${role}=${uri}`).join(' ')}`);
    }
}
