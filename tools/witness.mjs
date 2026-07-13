#!/usr/bin/env node
// tools/witness.mjs — the automated witness runner (`npm run witness`).
//
// Renders every suite scene that declares a `witness` spec (src/compiler/scenes/index.ts)
// in headless Chromium (WebGL2 via SwiftShader), reads back LINEAR HDR floats from the
// accumulation buffer, asserts the machine-readable checks, and prints a pass/fail table.
//
// This is deliberately NOT in vitest/CI: it needs minutes and a (software) GPU. Run it
// before/after transport-adjacent batches. glslang in vitest remains the static gate;
// this is the numeric one. See docs/fable-validation-scenes.md for where the numbers
// come from.
//
//   npm run witness                # all scenes with witness specs
//   npm run witness -- furnace eta # only these scenes
//   npm run witness -- --list      # list checks without rendering
//
// Exit code: number of failed checks (0 = all green).

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';
const DEFAULT_SIZE = [160, 120];
const DEFAULT_SPP = 64;
const RENDER_TIMEOUT_MS = 8 * 60 * 1000; // per (scene, strategy) render

// ---------------------------------------------------------------------------
// CLI
const argv = process.argv.slice(2);
const listOnly = argv.includes('--list');
const sceneFilter = argv.filter(a => !a.startsWith('--'));

// ---------------------------------------------------------------------------
// Dev server: reuse a running one, else spawn `npm run dev` and kill it on exit.
async function serverUp() {
    try {
        const res = await fetch(`${BASE_URL}/lab.html`, { signal: AbortSignal.timeout(1500) });
        return res.ok;
    } catch {
        return false;
    }
}

let devServer = null;
async function ensureServer() {
    if (await serverUp()) return;
    process.stdout.write('starting dev server… ');
    devServer = spawn('npm', ['run', 'dev'], {
        cwd: new URL('..', import.meta.url).pathname,
        stdio: 'ignore',
        detached: false,
    });
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (await serverUp()) {
            console.log('up.');
            return;
        }
    }
    throw new Error('dev server did not come up on :3000 within 30s');
}

function cleanup() {
    if (devServer && !devServer.killed) devServer.kill();
}
process.on('exit', cleanup);
process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
});

// ---------------------------------------------------------------------------
// Stats (all on linear HDR RGBA float arrays, bottom-left origin — readPixels order)
function regionBounds(region, W, H) {
    const r = region ?? { x: 0, y: 0, w: 1, h: 1 };
    return {
        x0: Math.max(0, Math.floor(r.x * W)),
        y0: Math.max(0, Math.floor(r.y * H)),
        x1: Math.min(W, Math.ceil((r.x + r.w) * W)),
        y1: Math.min(H, Math.ceil((r.y + r.h) * H)),
    };
}

function regionMean(px, W, H, region) {
    const { x0, y0, x1, y1 } = regionBounds(region, W, H);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            r += px[i]; g += px[i + 1]; b += px[i + 2];
            n++;
        }
    }
    return n ? [r / n, g / n, b / n] : [NaN, NaN, NaN];
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function frameMeanLum(px) {
    let s = 0;
    const n = px.length / 4;
    for (let i = 0; i < n; i++) s += lum(px[4 * i], px[4 * i + 1], px[4 * i + 2]);
    return s / n;
}

function nanCount(px) {
    let bad = 0;
    for (let i = 0; i < px.length; i++) {
        if (Number.isNaN(px[i])) { bad++; i += 4 - (i % 4); }
    }
    return bad;
}

/**
 * The two-gate estimator-equality statistic:
 *  - relMeanDiff — |Δ frame-mean luminance| / mean in LINEAR HDR: the bias gate
 *    (physics), converges ~1/√(px·spp) so it is tight even at headless budgets.
 *  - relRMSE — per-pixel luminance RMSE in DISPLAY space (soft tonemap l/(1+l)),
 *    relative to the mean tonemapped luminance: the structure gate (a shifted shadow,
 *    a missing shaft). Display space is what "converges to the same image" means to
 *    the eye, and it bounds the HDR firefly tail that would otherwise swamp the
 *    statistic at headless sample counts (media + point lights are the worst case).
 */
function pairStats(a, b) {
    const mA = frameMeanLum(a), mB = frameMeanLum(b);
    const tm = l => l / (1 + l);
    let sq = 0, tSum = 0;
    const n = a.length / 4;
    for (let i = 0; i < n; i++) {
        const la = tm(lum(a[4 * i], a[4 * i + 1], a[4 * i + 2]));
        const lb = tm(lum(b[4 * i], b[4 * i + 1], b[4 * i + 2]));
        sq += (la - lb) * (la - lb);
        tSum += (la + lb) / 2;
    }
    return {
        relMeanDiff: Math.abs(mA - mB) / ((mA + mB) / 2),
        relRMSE: Math.sqrt(sq / n) / (tSum / n),
    };
}

/**
 * Noise-normalized χ² (the default equality structure gate): per pixel-channel,
 * (a−b)² / (σ²ₐ+σ²ᵦ) with σ² = the MEASURED variance of each accumulated mean
 * (Welford buffer / (n−1)), averaged over the frame. Same integrand ⇒ ≈1 at any
 * spp; fireflies self-normalize (a spike inflates its own measured variance);
 * real bias grows ∝ spp. No per-scene threshold calibration.
 */
function chi2Stats(a, b) {
    const n = a.mean.length / 4;
    let sum = 0, count = 0;
    for (let i = 0; i < n; i++) {
        for (let c = 0; c < 3; c++) {
            const ma = a.mean[4 * i + c], mb = b.mean[4 * i + c];
            const d = ma - mb;
            // The denominator carries a measurement-precision floor: rgba32f
            // accumulation quantizes at ~mean·2⁻²⁴, and DETERMINISTIC pixels (direct
            // emitter hits, delta glass chains — zero sample variance in both arms)
            // may differ by last-ulp amounts between two differently-compiled
            // shaders. ~8 ulps (1e-6·mean) scores that as χ²≈0 while a REAL
            // deterministic difference still explodes the statistic.
            const q = (Math.abs(ma) + Math.abs(mb)) * 1e-6 + 1e-12;
            const s2 = Math.max(a.variance[4 * i + c], 0) / (a.spp - 1)
                     + Math.max(b.variance[4 * i + c], 0) / (b.spp - 1)
                     + q * q;
            sum += (d * d) / s2;
            count++;
        }
    }
    return count ? sum / count : 0;
}

// ---------------------------------------------------------------------------
// Noise metric: mean per-channel σ of the pixel mean (√(v/n)), relative to the
// region's mean radiance — the equal-spp estimator-comparison number.
function regionNoise(meanPx, varPx, W, H, region, n) {
    const { x0, y0, x1, y1 } = regionBounds(region, W, H);
    let sig = 0, rad = 0;
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            for (let c = 0; c < 3; c++) {
                sig += Math.sqrt(Math.max(varPx[i + c], 0) / n);
                rad += meanPx[i + c];
            }
        }
    }
    return rad > 0 ? sig / rad : NaN;
}

// ---------------------------------------------------------------------------
// Rendering: one browser, one page per scene, frames cached across checks/scenes.
const frameCache = new Map(); // `${scene}#${strategyIdx}#${W}x${H}#${spp}` → {px, W, H}
const varianceCache = new Map(); // same key → {mean, variance, W, H, spp}

/**
 * Render one strategy with accumulation FORCED to the 'variance' occupant (a cloned
 * strategy re-initialized in-page — the registry entry holds the live scene object),
 * and read back both the mean and the second-moment attachment.
 */
async function renderVarianceFrame(browser, registry, sceneId, strategyIdx, [W, H], spp) {
    const key = `${sceneId}#${strategyIdx}#${W}x${H}#${spp}`;
    if (varianceCache.has(key)) return varianceCache.get(key);

    const page = await browser.newPage();
    try {
        await page.goto(`${BASE_URL}/lab.html?scene=${sceneId}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.app !== undefined, null, { timeout: 120_000 });

        const t0 = Date.now();
        await page.evaluate(async ([sid, idx, w, h]) => {
            const app = window.app;
            const entry = window.sceneSuite[sid];
            app.stop();
            const strategy = JSON.parse(JSON.stringify(entry.strategies[idx]));
            strategy.estimator.accumulation = { type: 'variance' };
            strategy.id = `${strategy.id}__var`;
            // initialize() is additive: distinct strategy id → distinct renderer id,
            // nothing already loaded is clobbered.
            await app.initialize({ scene: entry.scene, strategies: [strategy], initialParameters: entry.initialParameters });
            app.resize(w, h);
        }, [sceneId, strategyIdx, W, H]);
        await page.evaluate(n => {
            window.__witnessDone = false; window.__witnessError = null;
            window.app.renderProduction(n)
                .then(() => { window.__witnessDone = true; })
                .catch(e => { window.__witnessError = String(e); });
        }, spp);
        await page.waitForFunction(() => window.__witnessDone === true || window.__witnessError !== null, null, { timeout: RENDER_TIMEOUT_MS, polling: 500 });
        const renderErr = await page.evaluate(() => window.__witnessError);
        if (renderErr) throw new Error(`renderProduction: ${renderErr}`);

        const [mean, variance] = await page.evaluate(() => [
            Array.from(window.app.readExport('hdr')),
            Array.from(window.app.readExport('variance')),
        ]);
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        process.stdout.write(`  rendered ${sceneId} / strategy ${strategyIdx} +variance @ ${W}×${H} ×${spp}spp (${secs}s)\n`);

        const frame = { mean: new Float32Array(mean), variance: new Float32Array(variance), W, H, spp };
        varianceCache.set(key, frame);
        return frame;
    } finally {
        await page.close();
    }
}

async function renderFrame(browser, registry, sceneId, strategyIdx, [W, H], spp) {
    const key = `${sceneId}#${strategyIdx}#${W}x${H}#${spp}`;
    if (frameCache.has(key)) return frameCache.get(key);

    const entry = registry[sceneId];
    if (!entry) throw new Error(`unknown scene '${sceneId}'`);
    const strategyId = entry.strategyIds[strategyIdx];
    if (!strategyId) throw new Error(`${sceneId}: no strategy at index ${strategyIdx}`);

    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    try {
        await page.goto(`${BASE_URL}/lab.html?scene=${sceneId}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.app !== undefined, null, { timeout: 120_000 });

        const t0 = Date.now();
        await page.evaluate(([w, h, sid]) => {
            const app = window.app;
            app.stop();
            app.selectRendererByStrategy(sid);
            app.resize(w, h); // small framebuffer = SwiftShader speed; also clears accumulation
        }, [W, H, strategyId]);
        // Fire the production render, then poll from node so we own the timeout.
        // A REJECTION must surface too — otherwise the poll hangs the full timeout.
        await page.evaluate(n => {
            window.__witnessDone = false; window.__witnessError = null;
            window.app.renderProduction(n)
                .then(() => { window.__witnessDone = true; })
                .catch(e => { window.__witnessError = String(e); });
        }, spp);
        await page.waitForFunction(() => window.__witnessDone === true || window.__witnessError !== null, null, {
            timeout: RENDER_TIMEOUT_MS, polling: 500,
        });
        const renderErr = await page.evaluate(() => window.__witnessError);
        if (renderErr) throw new Error(`renderProduction: ${renderErr}`);

        const px = new Float32Array(await page.evaluate(() => Array.from(window.app.readExport('hdr'))));
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        process.stdout.write(`  rendered ${sceneId} / ${strategyId} @ ${W}×${H} ×${spp}spp (${secs}s)\n`);
        if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);

        const frame = { px, W, H };
        frameCache.set(key, frame);
        return frame;
    } finally {
        await page.close();
    }
}

// ---------------------------------------------------------------------------
// Check evaluation
function fmt(v, digits = 4) {
    if (Array.isArray(v)) return `(${v.map(x => x.toFixed(digits)).join(', ')})`;
    return v.toFixed(digits);
}

async function runCheck(browser, registry, sceneId, spec, check) {
    const size = spec.size ?? DEFAULT_SIZE;
    const spp = spec.spp ?? DEFAULT_SPP;
    const label = check.label ?? check.kind;

    if (check.kind === 'mean') {
        const { px, W, H } = await renderFrame(browser, registry, sceneId, check.strategy ?? 0, size, spp);
        const bad = nanCount(px);
        if (bad) return { sceneId, label, pass: false, detail: `${bad} NaN components` };
        const measured = regionMean(px, W, H, check.region);
        const expect = Array.isArray(check.value) ? check.value : [check.value, check.value, check.value];
        const tol = Array.isArray(check.tol) ? check.tol : [check.tol, check.tol, check.tol];
        const pass = measured.every((m, i) => Math.abs(m - expect[i]) <= tol[i]);
        return { sceneId, label, pass, detail: `mean ${fmt(measured)} vs ${fmt(expect)} ±${fmt(tol)}` };
    }

    if (check.kind === 'equality' || check.kind === 'twin') {
        // Resolve the list of (scene, strategy) frames to compare pairwise.
        const parts = check.kind === 'equality'
            ? check.strategies.map(s => [sceneId, s])
            : [[sceneId, check.strategy ?? 0], [check.other.scene, check.other.strategy ?? 0]];
        const useRmse = check.rmse !== undefined; // opt-out for identical-stream arms

        if (useRmse) {
            const frames = [];
            for (const [sc, st] of parts) frames.push({ sc, st, ...(await renderFrame(browser, registry, sc, st, size, spp)) });
            for (const f of frames) {
                const bad = nanCount(f.px);
                if (bad) return { sceneId, label, pass: false, detail: `${f.sc}#${f.st}: ${bad} NaN components` };
            }
            let worst = { relMeanDiff: 0, relRMSE: 0 };
            for (let i = 0; i < frames.length; i++) {
                for (let j = i + 1; j < frames.length; j++) {
                    const s = pairStats(frames[i].px, frames[j].px);
                    worst.relMeanDiff = Math.max(worst.relMeanDiff, s.relMeanDiff);
                    worst.relRMSE = Math.max(worst.relRMSE, s.relRMSE);
                }
            }
            const pass = worst.relMeanDiff <= check.meanTol && worst.relRMSE <= check.rmse;
            return {
                sceneId, label, pass,
                detail: `Δmean ${(worst.relMeanDiff * 100).toFixed(2)}% (≤${check.meanTol * 100}%), rmse ${(worst.relRMSE * 100).toFixed(2)}% (≤${check.rmse * 100}%)`,
            };
        }

        // χ² gate: arms render with the variance occupant (mean + measured noise).
        const chi2Max = check.chi2 ?? 2.0;
        const frames = [];
        for (const [sc, st] of parts) frames.push({ sc, st, ...(await renderVarianceFrame(browser, registry, sc, st, size, spp)) });
        for (const f of frames) {
            const bad = nanCount(f.mean);
            if (bad) return { sceneId, label, pass: false, detail: `${f.sc}#${f.st}: ${bad} NaN components` };
        }
        let worst = { relMeanDiff: 0, chi2: 0 };
        for (let i = 0; i < frames.length; i++) {
            for (let j = i + 1; j < frames.length; j++) {
                const mA = frameMeanLum(frames[i].mean), mB = frameMeanLum(frames[j].mean);
                worst.relMeanDiff = Math.max(worst.relMeanDiff, Math.abs(mA - mB) / ((mA + mB) / 2));
                worst.chi2 = Math.max(worst.chi2, chi2Stats(frames[i], frames[j]));
            }
        }
        const pass = worst.relMeanDiff <= check.meanTol && worst.chi2 <= chi2Max;
        return {
            sceneId, label, pass,
            detail: `Δmean ${(worst.relMeanDiff * 100).toFixed(2)}% (≤${check.meanTol * 100}%), χ²ᵣ ${worst.chi2.toFixed(2)} (≤${chi2Max})`,
        };
    }

    if (check.kind === 'noise') {
        const measured = [];
        for (const st of check.strategies) {
            const f = await renderVarianceFrame(browser, registry, sceneId, st, size, spp);
            measured.push({ st, sigma: regionNoise(f.mean, f.variance, f.W, f.H, check.region, spp) });
        }
        const parts = measured.map(m => `${registry[sceneId].strategyIds[m.st]} ${(m.sigma * 100).toFixed(2)}%`);
        const lowestFirst = measured.every(m => m.sigma >= measured[0].sigma);
        const pass = check.assertFirstLowest ? lowestFirst : true;
        return { sceneId, label, pass, detail: `σ/µ @ ${spp}spp: ${parts.join(', ')}` };
    }

    return { sceneId, label, pass: false, detail: `unknown check kind '${check.kind}'` };
}

// ---------------------------------------------------------------------------
// Main
const GREEN = s => `\x1b[32m${s}\x1b[0m`;
const RED = s => `\x1b[31m${s}\x1b[0m`;
const DIM = s => `\x1b[2m${s}\x1b[0m`;

async function main() {
    await ensureServer();

    const browser = await chromium.launch({
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });

    try {
        // Pull the registry (witness specs + strategy ids) straight from the lab page —
        // one source of truth, no TS loading in node.
        const bootstrap = await browser.newPage();
        await bootstrap.goto(`${BASE_URL}/lab.html`, { waitUntil: 'domcontentloaded' });
        await bootstrap.waitForFunction(() => window.sceneSuite !== undefined, null, { timeout: 120_000 });
        const registry = await bootstrap.evaluate(() => {
            const out = {};
            for (const [id, entry] of Object.entries(window.sceneSuite)) {
                out[id] = {
                    witness: entry.witness ?? null,
                    strategyIds: entry.strategies.map(s => s.id),
                };
            }
            return out;
        });
        await bootstrap.close();

        const scenes = Object.keys(registry)
            .filter(id => registry[id].witness)
            .filter(id => sceneFilter.length === 0 || sceneFilter.includes(id));

        if (scenes.length === 0) {
            console.error(sceneFilter.length ? `no witness scenes match: ${sceneFilter.join(', ')}` : 'no witness specs found');
            process.exitCode = 1;
            return;
        }

        if (listOnly) {
            for (const id of scenes) {
                const spec = registry[id].witness;
                console.log(`${id}  ${DIM(`[${(spec.size ?? DEFAULT_SIZE).join('×')} ×${spec.spp ?? DEFAULT_SPP}spp]`)}`);
                for (const c of spec.checks) console.log(`  - ${c.label ?? c.kind}`);
            }
            return;
        }

        console.log(`witness: ${scenes.length} scene(s)\n`);
        const results = [];
        for (const id of scenes) {
            const spec = registry[id].witness;
            for (const check of spec.checks) {
                try {
                    results.push(await runCheck(browser, registry, id, spec, check));
                } catch (err) {
                    results.push({ sceneId: id, label: check.label ?? check.kind, pass: false, detail: `ERROR: ${err.message}` });
                }
            }
        }

        // The table
        console.log('');
        const wScene = Math.max(...results.map(r => r.sceneId.length), 5);
        const wLabel = Math.max(...results.map(r => r.label.length), 5);
        for (const r of results) {
            const mark = r.pass ? GREEN('PASS') : RED('FAIL');
            console.log(`${mark}  ${r.sceneId.padEnd(wScene)}  ${r.label.padEnd(wLabel)}  ${DIM(r.detail)}`);
        }
        const failed = results.filter(r => !r.pass).length;
        console.log(`\n${results.length} checks, ${results.length - failed} passed, ${failed} failed`);
        process.exitCode = failed;
    } finally {
        await browser.close();
        cleanup();
    }
}

main().catch(err => {
    console.error(err);
    cleanup();
    process.exit(1);
});
