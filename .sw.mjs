import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const id of process.argv.slice(2)) {
  const p = await b.newPage();
  const t0 = Date.now();
  let out = '>90000';
  try { await p.goto(`http://localhost:3000/lab.html?scene=${id}`, { waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => window.app !== undefined, null, { timeout: 90000 }); out = Date.now()-t0; } catch {}
  console.log(id.padEnd(22), out);
  await p.close();
}
await b.close();
