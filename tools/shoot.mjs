#!/usr/bin/env node
// tools/shoot.mjs — finished pictures on this machine's GPU (`npm run shoot`).
//
//   npm run shoot -- <scene-id...> [--spp N] [--size WxH] [--out dir] [--format png|hdr|both]
//                    [--salt S] [--renderer K] [--tile PX] [--swiftshader]
//
//   --spp N         samples per pixel (default 1024)
//   --size WxH      image size in pixels (default 1280x853)
//   --out dir       where the files go (default shots/)
//   --format F      png, hdr or both (default png)
//   --salt S        pin the RNG salt, so the same command gives the same pixels; without it
//                   the App picks the salt, and the file's stamp records it either way
//   --renderer K    the scene's K-th renderer, counted from 1 like the lab's number keys
//                   (default 1)
//   --tile PX       render in tiles of PX pixels (the App's tiled render). Images larger than
//                   4K UHD (3840×2160 pixels in all) are tiled at the App's default tile size
//                   even without it, as the lab's render dialog does for 8K.
//   --swiftshader   render on the software rasterizer instead (for comparisons with the
//                   witness runner's pictures)
//
// Each scene opens in its own page of headless Chromium (lab.html?scene=<id>, driven like the
// witness runner) and is rendered by the App's production render; the main picture
// ('radiance') is saved by the App's own writer, so every file carries the App's
// reproducibility stamp. On macOS Chromium reaches the GPU through ANGLE's Metal backend.
// The GL renderer string is printed first, and a software renderer is an error unless
// --swiftshader asked for it. The dev server runs on WITNESS_PORT (default 3000).
//
// The App draws one sample per animation frame, so headless Chromium's 60 Hz frame clock
// bounds a render below by spp/60 seconds however fast the GPU is.

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { devServer } from './devServer.mjs';

const UHD_PIXELS = 3840 * 2160;
const LOAD_TIMEOUT_MS = 120_000;
const SAVE_TIMEOUT_MS = 120_000;

function parseArgs(argv) {
    const opts = { scenes: [], spp: 1024, size: [1280, 853], out: 'shots', formats: ['png'], salt: null, renderer: 1, tile: null, swiftshader: false };
    const value = (i, flag) => {
        if (i >= argv.length || argv[i].startsWith('--')) throw new Error(`${flag} needs a value`);
        return argv[i];
    };
    const positiveInt = (s, flag) => {
        const n = Number(s);
        if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} needs a positive integer (got '${s}')`);
        return n;
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case '--spp': opts.spp = positiveInt(value(++i, a), a); break;
            case '--size': {
                const m = /^(\d+)x(\d+)$/.exec(value(++i, a));
                if (!m) throw new Error(`--size needs WxH (got '${argv[i]}')`);
                opts.size = [positiveInt(m[1], a), positiveInt(m[2], a)];
                break;
            }
            case '--out': opts.out = value(++i, a); break;
            case '--format': {
                const f = value(++i, a);
                if (!['png', 'hdr', 'both'].includes(f)) throw new Error(`--format is png, hdr or both (got '${f}')`);
                opts.formats = f === 'both' ? ['hdr', 'png'] : [f];
                break;
            }
            case '--salt': {
                const s = Number(value(++i, a));
                if (!Number.isInteger(s) || s < 0) throw new Error(`--salt needs a non-negative integer (got '${argv[i]}')`);
                opts.salt = s;
                break;
            }
            case '--renderer': opts.renderer = positiveInt(value(++i, a), a); break;
            case '--tile': opts.tile = positiveInt(value(++i, a), a); break;
            case '--swiftshader': opts.swiftshader = true; break;
            default:
                if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
                opts.scenes.push(a);
        }
    }
    if (opts.scenes.length === 0) throw new Error('name at least one scene id (the ids are the gallery cards\' ?scene= values)');
    return opts;
}

async function glRenderer(page) {
    return page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return 'no WebGL2 context';
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    });
}

/** Render one scene and save its files into `outDir`; returns the paths and the seconds. */
async function shoot(browser, baseUrl, sceneId, opts, outDir) {
    const [W, H] = opts.size;
    const tiled = opts.tile !== null || W * H > UHD_PIXELS;
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    const saved = [];   // promises of the paths the downloads are written to
    try {
        const t0 = Date.now();
        // ?witness: the page sets up the App without starting its interactive loop.
        await page.goto(`${baseUrl}/lab.html?scene=${encodeURIComponent(sceneId)}&witness`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.app !== undefined, null, { timeout: LOAD_TIMEOUT_MS });
        // The lab falls back to its default scene for an unknown id; refuse instead.
        const strategyIds = await page.evaluate(sid => window.sceneSuite?.[sid]?.strategies.map(s => s.id) ?? null, sceneId);
        if (!strategyIds) throw new Error(`no scene '${sceneId}' in the gallery`);
        const strategyId = strategyIds[opts.renderer - 1];
        if (!strategyId) throw new Error(`${sceneId} has ${strategyIds.length} renderer(s); --renderer ${opts.renderer} names none`);

        const base = `${sceneId}_${strategyId}_${W}x${H}_${opts.spp}spp${opts.salt === null ? '' : `_salt${opts.salt}`}`;
        page.on('download', d => {
            const ext = d.suggestedFilename().split('.').pop();
            const path = join(outDir, `${base}.${ext}`);
            saved.push(d.saveAs(path).then(() => path));
        });
        const loadSecs = (Date.now() - t0) / 1000;

        const t1 = Date.now();
        await page.evaluate(([sid, w, h, spp, salt, formats, tiled, tile]) => {
            const app = window.app;
            app.stop();
            if (salt !== null) app.pinResetSalt(salt);
            app.selectRendererByStrategy(sid);
            const save = formats.map(format => ({ picture: 'radiance', format }));
            const job = tiled
                ? app.renderTiled({ width: w, height: h, spp, save, ...(tile === null ? {} : { tileSize: tile }) })
                : app.renderProduction(spp, { width: w, height: h, save });
            window.__shootDone = false; window.__shootError = null;
            job.then(() => { window.__shootDone = true; }, e => { window.__shootError = String(e); });
        }, [strategyId, W, H, opts.spp, opts.salt, opts.formats, tiled, opts.tile]);
        // Poll from node so a stalled render cannot hang an evaluate.
        await page.waitForFunction(() => window.__shootDone !== false || window.__shootError != null, null, { timeout: 0, polling: 1000 });
        const { done, error } = await page.evaluate(() => ({ done: window.__shootDone, error: window.__shootError }));
        if (error) throw new Error(`render failed: ${error}`);
        if (done !== true) throw new Error('the page reloaded during the render (a source file changed?)');

        const deadline = Date.now() + SAVE_TIMEOUT_MS;
        while (saved.length < opts.formats.length) {
            if (Date.now() > deadline) throw new Error(`only ${saved.length} of ${opts.formats.length} files arrived`);
            await new Promise(r => setTimeout(r, 100));
        }
        const paths = await Promise.all(saved);
        if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
        return { paths, strategyId, tiled, loadSecs, renderSecs: (Date.now() - t1) / 1000 };
    } finally {
        await page.close();
    }
}

async function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (e) {
        console.error(String(e.message ?? e));
        process.exit(2);
    }
    const outDir = resolve(opts.out);
    mkdirSync(outDir, { recursive: true });

    const server = devServer(Number(process.env.WITNESS_PORT ?? 3000));
    await server.ensure();
    const browser = await chromium.launch({
        args: opts.swiftshader ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
            : process.platform === 'darwin' ? ['--use-angle=metal'] : [],
    });
    let failures = 0;
    try {
        const probe = await browser.newPage();
        const renderer = await glRenderer(probe);
        await probe.close();
        console.log(`GL renderer: ${renderer}`);
        if (/swiftshader/i.test(renderer) !== opts.swiftshader) {
            throw new Error(opts.swiftshader ? 'asked for SwiftShader but got another renderer' : 'Chromium fell back to the software renderer; no GPU picture can be made here');
        }
        const [W, H] = opts.size;
        for (const sceneId of opts.scenes) {
            try {
                const r = await shoot(browser, server.baseUrl, sceneId, opts, outDir);
                console.log(`${sceneId} / ${r.strategyId} @ ${W}×${H} ×${opts.spp}spp${r.tiled ? ' (tiled)' : ''}: `
                    + `load ${r.loadSecs.toFixed(1)}s, render+save ${r.renderSecs.toFixed(1)}s`);
                for (const p of r.paths) console.log(`  ${p}`);
            } catch (e) {
                failures++;
                console.error(`${sceneId}: ${e.message ?? e}`);
            }
        }
    } finally {
        await browser.close();
        server.stop();
    }
    process.exit(failures);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
