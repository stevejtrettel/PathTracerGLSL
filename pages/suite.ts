/**
 * Scene Suite gallery — the landing page (index.html, served at /)
 *
 * Lists every scene in the merged suite (pages/registry.ts — witnesses + demos)
 * with what it exercises and its pass criterion; click a card to build + render it in the
 * lab (lab.html?scene=<id>). Deliberately a plain static page: each scene opens with a
 * fresh page load, so compiles are isolated and the ErrorOverlay catches each scene's
 * errors on its own.
 *
 * The automated form of the `expected` lines lives in src/witnesses/ and runs via
 * `npm run witness` (the §11 harness, built July 2026).
 */

import { sceneSuite, isAsyncSceneEntry } from './registry.js';

const style = document.createElement('style');
style.textContent = `
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 2rem; background: #111417; color: #d7dce1;
    font: 14px/1.5 -apple-system, 'Segoe UI', system-ui, sans-serif;
  }
  h1 { font-size: 1.2rem; font-weight: 600; margin: 0 0 0.25rem; }
  .sub { color: #8a939c; margin-bottom: 1.5rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 0.9rem; }
  a.card {
    display: block; padding: 0.9rem 1rem; border: 1px solid #262c33; border-radius: 8px;
    background: #171b20; text-decoration: none; color: inherit;
    transition: border-color 120ms, background 120ms;
  }
  a.card:hover { border-color: #4a89c7; background: #1a2027; }
  .card h2 { font-size: 0.95rem; font-weight: 600; margin: 0; color: #e8edf2; }
  .card .id { color: #5f6b76; font-weight: 400; font-family: ui-monospace, monospace; font-size: 0.8rem; }
  .card .strategies { color: #8a939c; font-size: 0.78rem; margin: 0.15rem 0 0.5rem; }
  .card .exercises { color: #aab3bc; font-size: 0.82rem; margin: 0; }
  .card .expected {
    margin: 0.55rem 0 0; padding: 0.4rem 0.55rem; font-size: 0.8rem;
    border-left: 3px solid #3f7a4f; background: #16211a; color: #a8c8ae; border-radius: 0 4px 4px 0;
  }
  .card .expected b { color: #cfe8d4; font-weight: 600; }
`;
document.head.appendChild(style);

const header = document.createElement('div');
header.innerHTML = `
  <h1>Scene Suite</h1>
  <div class="sub">${Object.keys(sceneSuite).length} scenes — click to build &amp; render.
  In the lab: keys 1–9 switch strategies, <code>r</code> resets accumulation.</div>
`;
document.body.appendChild(header);

const grid = document.createElement('div');
grid.className = 'grid';

for (const [id, entry] of Object.entries(sceneSuite)) {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = `lab.html?scene=${encodeURIComponent(id)}`;

    const strategies = entry.strategies
        .map((s, i) => `${i + 1}: ${s.id}${s.estimator.lightSelection ? ` (${s.estimator.lightSelection})` : ''}`)
        .join('   ');

    card.innerHTML = `
        <h2>${isAsyncSceneEntry(entry) ? entry.name : entry.scene.name} <span class="id">${id}</span></h2>
        <div class="strategies">${strategies}</div>
        <p class="exercises">${entry.exercises}</p>
        ${entry.expected ? `<div class="expected"><b>Expect:</b> ${entry.expected}</div>` : ''}
    `;
    grid.appendChild(card);
}

document.body.appendChild(grid);
