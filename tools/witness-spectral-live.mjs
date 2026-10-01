// Run against a Vite dev or preview server. Exercise real parameter uploads without recompilation.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:3000';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function open(scene) {
    const page = await browser.newPage();
    await page.goto(`${base}/lab.html?scene=${scene}&witness`);
    await page.waitForFunction(() => window.app !== undefined, null, { timeout: 120_000 });
    await page.evaluate(() => window.app.stop());
    return page;
}
async function render(page) {
    await page.bringToFront();
    return page.evaluate(async () => {
        const app = window.app;
        app.stop();
        app.pinResetSalt(173);
        app.resize(32, 24);
        await app.renderProduction(32, { width: 32, height: 24 });
        return Array.from(app.readExport('radiance'));
    });
}
function compare(actual, expected, name) {
    assert.equal(actual.length, 32 * 24 * 4);
    assert.equal(actual.length, expected.length);
    let max = 0, sum2 = 0;
    for (let i = 0; i < actual.length; i++) {
        const error = actual[i] - expected[i];
        assert(Number.isFinite(error), `${name}: finite pixels`);
        max = Math.max(max, Math.abs(error));
        sum2 += error * error;
    }
    const rms = Math.sqrt(sum2 / actual.length);
    assert(max < 0.0005 && rms < 0.00001, `${name}: max ${max}, RMS ${rms}`);
    console.log(`PASS ${name}: max ${max}, RMS ${rms}`);
}
try {
    const live = await open('spectral-live');
    const points = await live.evaluate(() => {
        const scene = window.sceneSuite['spectral-live'].scene;
        const defaults = {
            'surface.albedo': scene.materials.surface.albedo.default,
            'surface.emission': scene.materials.surface.emission.default,
            'lamp.emission': scene.lights[1].emission.default,
            'sky.color': scene.environment.color.default,
        };
        window.liveRenderer = window.app.getActiveRenderer();
        window.initialSession = window.app.saveSession();
        return [
            ['defaults', defaults],
            ['changed', window.sceneSuite['spectral-live-changed'].initialParameters],
            ['zero lamp and albedo', { ...defaults, 'surface.albedo': 0, 'lamp.emission': 0 }],
            ['scalar colours and unit albedo', { 'surface.albedo': 1, 'surface.emission': 0.1, 'lamp.emission': 3, 'sky.color': 0.2 }],
            ['restored defaults', defaults],
        ];
    });
    for (const [name, values] of points) {
        await live.evaluate(({ name, values }) => {
            if (name === 'restored defaults') window.app.restoreSession(window.initialSession);
            else window.app.setParameters(values);
        }, { name, values });
        const actual = await render(live);
        assert(await live.evaluate(() => window.app.getActiveRenderer() === window.liveRenderer), 'live writes do not recompile');
        const reference = await open('spectral-live-ref');
        await reference.evaluate(async values => {
            const entry = window.sceneSuite['spectral-live-ref'];
            const scene = structuredClone(entry.scene);
            scene.id = 'live-constant-reference';
            scene.materials.surface.albedo = values['surface.albedo'];
            scene.materials.surface.emission = values['surface.emission'];
            scene.lights[1].emission = values['lamp.emission'];
            scene.environment.color = values['sky.color'];
            await window.app.initialize({ scene, strategies: entry.strategies });
            window.app.stop();
        }, values);
        compare(actual, await render(reference), name);
        await reference.close();
    }
    await live.evaluate(() => window.app.setParameters({
        'sky.color': 0, 'camera.position': [0, 5, 0], 'camera.target': [0, 6, -1],
    }));
    const blackSky = await render(live);
    assert(blackSky.every((v, i) => i % 4 === 3 || v === 0), 'zero live sky emits no radiance');
    console.log('PASS zero sky after a nonzero live sky');
} finally {
    await browser.close();
}
