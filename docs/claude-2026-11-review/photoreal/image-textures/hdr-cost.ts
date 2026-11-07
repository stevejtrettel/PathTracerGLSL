// Measure CPU parse + importance-table cost and sizes of one 4k trial HDR (node, no GPU).
import { readFileSync } from 'node:fs';
import { HDRLoader } from '/Users/stevetrettel/Code/PathTracerGLSL/src/engine/loaders/hdr-loader.js';
import { buildEnvImportanceTable } from '/Users/stevetrettel/Code/PathTracerGLSL/src/components/env/importance.js';
const f = '/Users/stevetrettel/Code/PathTracerGLSL/public/trial/hdri/venice_sunset_4k.hdr';
const buf = readFileSync(f);
let t = performance.now();
const hdr = HDRLoader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const tParse = performance.now() - t;
t = performance.now();
const tab = (buildEnvImportanceTable as any)(hdr.data, hdr.width, hdr.height);
const tTab = performance.now() - t;
console.log(JSON.stringify({ w: hdr.width, h: hdr.height, rgbMB: hdr.data.byteLength / 1e6, parseMs: Math.round(tParse), tableMs: Math.round(tTab), condMB: tab.cdf?.cond?.byteLength / 1e6 }));
