// Digest the compiled output of every suite scene, to show that a change leaves it unchanged.
//
//   npm run digest -- <out.json>                    # digest the whole suite (witnesses ∪ demos)
//   npm run digest -- <out.json> --keep <dir>       # …and keep the text of every part in <dir>
//   npm run digest -- --compare <a.json> <b.json>   # which scenes, and which parts, differ
//
// Each scene is compiled with its declared strategies (Compiler.compileScene). The digest covers
// every renderer's shaders, uniforms, what their compute closures return (at the parameter
// defaults and at one moved parameter set), defaults, parameters, pipeline, export targets and
// source maps; the scene-data plan, including the contents of its packed arrays; and the
// warnings. Text comes from tests/helpers/compiledJson.ts. Each part is
// hashed on its own, keyed by renderer id, so a comparison says where a difference is.
// Runs through vite-node so the GLSL `?raw` imports resolve as in the app.
//
// --keep writes the exact text each hash was taken from to <dir>/<scene>/<part>.json, and the
// digest records <dir>, so two kept digests can be compared by reading the parts that differ
// (`--compare` prints a `git diff --no-index` line for each). The text shows pipelines, exports,
// recipes, uniforms, closure results and shaders in full; packed data arrays appear only as their
// length and hash (tests/helpers/compiledJson.ts).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Compiler } from '../src/compiler/Compiler.js';
import type { CompiledScene, ParameterMetadata } from '../src/compiler/types.js';
import { sceneSuite, isAsyncSceneEntry } from '../pages/registry.js';
import { compiledJson, hashText } from '../tests/helpers/compiledJson.js';

interface Digest {
    /** Scene id → part name → hash. Parts: `<rendererId>.shaders`, `<rendererId>.rest`,
     *  `sceneData`, `dataReads`, `warnings`; or `error` when the scene does not compile. */
    scenes: Record<string, Record<string, string>>;
    /** Async suite entries (scenes built at load time), which this digest does not compile. */
    skipped: string[];
    /** Absolute path of the directory holding each part's text (`--keep`), if kept. */
    kept?: string;
}

/** A parameter value moved partway across its declared range: numbers go 37% of the way from
 *  the default toward the far end of the range (or grow by a quarter without one); colors and
 *  vectors are scaled by 0.8 and offset by 0.05 per channel. Other values keep their default. */
function movedValue(meta: ParameterMetadata): unknown {
    const d = meta.default;
    if (typeof d === 'number') {
        if (meta.range === undefined) return d * 1.25 + 0.1;
        const [lo, hi] = meta.range;
        return hi > d ? d + 0.37 * (hi - d) : d - 0.37 * (d - lo);
    }
    if (Array.isArray(d) && d.every((c) => typeof c === 'number')) return d.map((c: number) => c * 0.8 + 0.05);
    return d;
}

/** Every uniform's compute closure, evaluated at the parameter defaults and at the moved set.
 *  A closure that throws for lack of an engine-supplied parameter records that it threw. */
function closureResults(r: CompiledScene['renderers'][number]): unknown {
    const meta = Object.entries(r.parameters ?? {});
    const defaults = Object.fromEntries(meta.map(([path, m]) => [path, m.default]));
    const moved = Object.fromEntries(meta.map(([path, m]) => [path, movedValue(m)]));
    const at = (compute: (p: Record<string, unknown>) => unknown, params: Record<string, unknown>) => {
        try { return compute(params); } catch { return '[throws]'; }
    };
    return r.uniforms.map((u) => [u.uniform, at(u.compute, defaults), at(u.compute, moved)]);
}

/** Each part's text, keyed by part name. The digest hashes exactly these texts. */
function sceneTexts(compiled: CompiledScene): Record<string, string> {
    const texts: Record<string, string> = {};
    for (const r of compiled.renderers) {
        const { shaders, ...rest } = r;
        const text = compiledJson(shaders);
        // A digest that holds no shader text proves nothing about shaders.
        if (!text.includes('void main')) throw new Error(`digest: renderer '${r.id}' serialized without shader text`);
        texts[`${r.id}.shaders`] = text;
        texts[`${r.id}.rest`] = compiledJson(rest);
        // `rest` writes each compute closure as '[fn]'; this part records what they compute.
        texts[`${r.id}.closures`] = compiledJson(closureResults(r));
    }
    texts.sceneData = compiledJson(compiled.sceneData);
    texts.dataReads = compiledJson(compiled.dataReads);
    texts.warnings = compiledJson(compiled.warnings);
    return texts;
}

function digestScene(texts: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(texts).map(([part, text]) => [part, hashText(text)]));
}

function digestSuite(keep: string | null): Digest {
    const compiler = new Compiler();
    const out: Digest = { scenes: {}, skipped: [], ...(keep !== null ? { kept: keep } : {}) };
    for (const [id, entry] of Object.entries(sceneSuite)) {
        if (isAsyncSceneEntry(entry)) { out.skipped.push(id); continue; }
        let compiled: CompiledScene;
        try {
            compiled = compiler.compileScene(entry.scene, entry.strategies);
        } catch (err) {
            out.scenes[id] = { error: hashText(String(err)) };
            continue;
        }
        const texts = sceneTexts(compiled);
        out.scenes[id] = digestScene(texts);
        if (keep !== null) {
            mkdirSync(join(keep, id), { recursive: true });
            for (const [part, text] of Object.entries(texts)) writeFileSync(join(keep, id, `${part}.json`), text);
        }
    }
    return out;
}

function compare(a: Digest, b: Digest): void {
    const ids = [...new Set([...Object.keys(a.scenes), ...Object.keys(b.scenes)])];
    const byPart = new Map<string, string[]>();   // part kind → scenes where it differs
    const diffs: string[] = [];                    // how to read each differing part, when both kept
    let same = 0;
    for (const id of ids) {
        const pa = a.scenes[id], pb = b.scenes[id];
        if (pa === undefined || pb === undefined) {
            const kind = pa === undefined ? 'only in second' : 'only in first';
            byPart.set(kind, [...(byPart.get(kind) ?? []), id]);
            continue;
        }
        const differing = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter((k) => pa[k] !== pb[k]);
        if (differing.length === 0) { same++; continue; }
        if (a.kept !== undefined && b.kept !== undefined) {
            for (const k of differing) diffs.push(`git diff --no-index ${join(a.kept, id, `${k}.json`)} ${join(b.kept, id, `${k}.json`)}`);
        }
        for (const k of differing) {
            const kind = k.includes('.') ? k.slice(k.lastIndexOf('.') + 1) : k;   // shaders | rest | sceneData | …
            const list = byPart.get(kind) ?? [];
            if (!list.includes(id)) list.push(id);
            byPart.set(kind, list);
        }
    }
    console.log(`${same} of ${ids.length} scenes identical`);
    for (const [kind, scenes] of byPart) console.log(`  ${kind} differs in ${scenes.length}: ${scenes.join(', ')}`);
    if (a.skipped.length > 0 || b.skipped.length > 0) console.log(`  not compiled (async): ${[...new Set([...a.skipped, ...b.skipped])].join(', ')}`);
    if (diffs.length > 0) {
        console.log('\nTo read the differing parts:');
        for (const d of diffs) console.log(`  ${d}`);
    }
    process.exitCode = same === ids.length ? 0 : 1;
}

const args = process.argv.slice(2);
if (args[0] === '--compare') {
    if (args.length !== 3) throw new Error('usage: digest-compiled --compare <a.json> <b.json>');
    compare(JSON.parse(readFileSync(args[1], 'utf8')), JSON.parse(readFileSync(args[2], 'utf8')));
} else {
    const keepAt = args.indexOf('--keep');
    const rest = keepAt >= 0 ? args.filter((_, i) => i !== keepAt && i !== keepAt + 1) : args;
    if (rest.length !== 1 || (keepAt >= 0 && args[keepAt + 1] === undefined)) throw new Error('usage: digest-compiled <out.json> [--keep <dir>]');
    const keep = keepAt >= 0 ? resolve(args[keepAt + 1]) : null;
    // A kept directory is evidence for one digest: refuse to overwrite another digest's parts.
    if (keep !== null && existsSync(keep) && readdirSync(keep).length > 0) throw new Error(`--keep ${keep} is not empty; choose a new directory`);
    const digest = digestSuite(keep);
    writeFileSync(rest[0], JSON.stringify(digest, null, 1));
    console.log(`digested ${Object.keys(digest.scenes).length} scenes -> ${rest[0]}${digest.skipped.length ? ` (${digest.skipped.length} async skipped)` : ''}${keep !== null ? `; parts kept in ${keep}` : ''}`);
}
