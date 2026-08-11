import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const client = await page.context().newCDPSession(page);
await client.send('Debugger.enable');
const stacks = [];
client.on('Debugger.paused', (e) => {
    stacks.push(e.callFrames.slice(0, 10).map((f) => `${f.functionName || '(anon)'} @ ${(f.url || '').split('/').slice(-2).join('/')}:${f.location.lineNumber}`));
    client.send('Debugger.resume').catch(() => {});
});
await page.goto('http://localhost:3000/lab.html?scene=cube-cloud-ref', { waitUntil: 'domcontentloaded' }).catch(() => {});
for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 6000));
    await client.send('Debugger.pause').catch(() => {});
}
await new Promise((r) => setTimeout(r, 2000));
stacks.forEach((s, i) => console.log(`--- sample ${i}:\n${s.join('\n')}`));
await browser.close();
