// Run against a running Vite dev or preview server.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:3000';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    const requests = [], logs = [];
    page.on('request', request => {
        if (request.resourceType() === 'fetch' && request.url().includes('.bin')) requests.push(request.url());
    });
    page.on('console', message => logs.push(message.text()));
    await page.goto(`${base}/lab.html?scene=spectral-direct&witness`);
    await page.waitForFunction(() => window.app !== undefined, null, { timeout: 120_000 });
    const before = await page.evaluate(async () => {
        const app = window.app;
        app.stop();
        app.pinResetSalt(73);
        app.resize(12, 10);
        await app.renderProduction(16);
        return Array.from(app.readExport('radiance'));
    });
    assert.equal(requests.length, 2, 'both versioned assets fetched once');
    await page.evaluate(() => {
        window.lossExtension = window.app.getCanvas().getContext('webgl2').getExtension('WEBGL_lose_context');
        window.lossExtension.loseContext();
    });
    await page.waitForFunction(() => window.app.getCanvas().getContext('webgl2').isContextLost());
    await page.evaluate(() => window.lossExtension.restoreContext());
    for (let i = 0; i < 200 && !logs.some(s => s.includes('restored after WebGL context loss')); i++) {
        await page.waitForTimeout(100);
    }
    assert(logs.some(s => s.includes('restored after WebGL context loss')), 'app restored its resources');
    const after = await page.evaluate(async () => {
        const app = window.app;
        app.stop();
        app.pinResetSalt(73);
        await app.renderProduction(16);
        return Array.from(app.readExport('radiance'));
    });
    assert.deepEqual(after, before, 'restored image');
    assert.equal(requests.length, 2, 'context restore uses retained immutable bytes');
    const stamp = await page.evaluate(() => window.app.buildRenderStamp());
    assert.equal(stamp.measurement.sensor, 'cie1931');
    assert.equal(stamp.measurement.colorModelVersion, 'jh-cie1931-d65-v1');
    assert.equal(stamp.strategy.estimator.wavelengths, 'uniform');
    console.log('PASS assets, metadata, context restoration and exact pixels:', base);
} finally {
    await browser.close();
}
