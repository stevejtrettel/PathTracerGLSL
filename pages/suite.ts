/**
 * Scene Suite gallery — the landing page (index.html, served at /)
 *
 * Renders the merged suite (pages/registry.ts — witnesses + demos) grouped by the
 * purpose sections in pages/sections.ts: one compact row per scene, expandable to
 * the full `exercises` / `expected` prose. Fixture ref arms (a twin's other half)
 * fold into their primary's row as links instead of taking a row of their own.
 * Click a scene name to build + render it in the lab (lab.html?scene=<id>).
 * Deliberately a plain static page: each scene opens with a fresh page load, so
 * compiles are isolated and the ErrorOverlay catches each scene's errors on its own.
 *
 * The automated form of the `expected` lines lives in tests/witnesses/ and runs via
 * `npm run witness` (the §11 harness, built July 2026).
 */

import { sceneSuite, demoSuite, isAsyncSceneEntry } from './registry.js';
import { gallerySections } from './sections.js';
import type { AnySceneSuiteEntry } from './registry.js';

const style = document.createElement('style');
style.textContent = `
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 2rem; background: #111417; color: #d7dce1;
    font: 14px/1.5 -apple-system, 'Segoe UI', system-ui, sans-serif;
  }
  main { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.2rem; font-weight: 600; margin: 0 0 0.25rem; }
  .sub { color: #8a939c; margin-bottom: 1rem; }
  nav.sections {
    position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; gap: 0.35rem;
    padding: 0.6rem 0; margin: 0 0 0.5rem; background: rgba(17, 20, 23, 0.94);
    backdrop-filter: blur(4px); border-bottom: 1px solid #232930;
  }
  nav.sections a {
    font-size: 0.75rem; color: #aab3bc; text-decoration: none; padding: 0.15rem 0.55rem;
    border: 1px solid #262c33; border-radius: 999px; background: #171b20;
    transition: border-color 120ms, color 120ms;
  }
  nav.sections a:hover { border-color: #4a89c7; color: #e8edf2; }
  section.group { margin: 1.6rem 0 0; }
  section.group h2 {
    font-size: 1rem; font-weight: 600; margin: 0; color: #e8edf2;
    scroll-margin-top: 3.5rem;
  }
  section.group h2 .count { color: #5f6b76; font-weight: 400; font-size: 0.8rem; }
  section.group .blurb { color: #8a939c; font-size: 0.8rem; margin: 0.1rem 0 0.6rem; }
  details.row {
    border: 1px solid #232930; border-radius: 6px; margin: 0.3rem 0; background: #14181d;
    transition: border-color 120ms;
  }
  details.row:hover { border-color: #3a4450; }
  details.row[open] { border-color: #4a89c7; background: #171b20; }
  details.row summary {
    display: flex; align-items: baseline; gap: 0.55rem; padding: 0.42rem 0.7rem;
    cursor: pointer; list-style: none;
  }
  details.row summary::-webkit-details-marker { display: none; }
  .row .name a { color: #e8edf2; font-weight: 600; font-size: 0.88rem; text-decoration: none; white-space: nowrap; }
  .row .name a:hover { color: #7ab3e8; text-decoration: underline; }
  .row .id { color: #5f6b76; font-family: ui-monospace, monospace; font-size: 0.75rem; white-space: nowrap; }
  .chip {
    font-size: 0.66rem; padding: 0.02rem 0.4rem; border-radius: 999px; white-space: nowrap;
    border: 1px solid #2c333c; color: #8a939c;
  }
  .chip.gated { color: #a8c8ae; border-color: #2e4a36; }
  .chip.demo { color: #9ec0e8; border-color: #2e4258; }
  .chip.data { color: #c9aee8; border-color: #443158; }
  .row .teaser {
    color: #8a939c; font-size: 0.76rem; flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row .body { padding: 0 0.7rem 0.6rem; border-top: 1px solid #1d232a; }
  .row .strategies { color: #8a939c; font-size: 0.78rem; margin: 0.5rem 0 0.4rem; font-family: ui-monospace, monospace; }
  .row .exercises { color: #aab3bc; font-size: 0.82rem; margin: 0; }
  .row .expected {
    margin: 0.55rem 0 0; padding: 0.4rem 0.55rem; font-size: 0.8rem;
    border-left: 3px solid #3f7a4f; background: #16211a; color: #a8c8ae; border-radius: 0 4px 4px 0;
  }
  .row .expected b { color: #cfe8d4; font-weight: 600; }
  .row .partners { color: #8a939c; font-size: 0.78rem; margin: 0.55rem 0 0; }
  .row .partners a { color: #7ab3e8; text-decoration: none; font-family: ui-monospace, monospace; }
  .row .partners a:hover { text-decoration: underline; }
`;
document.head.appendChild(style);

const main = document.createElement('main');
document.body.appendChild(main);

const sceneCount = Object.keys(sceneSuite).length;
const header = document.createElement('div');
header.innerHTML = `
  <h1>Scene Suite</h1>
  <div class="sub">${sceneCount} scenes in ${gallerySections.length} sections — click a name to build &amp; render,
  click a row for what it exercises. In the lab: keys 1–9 switch strategies, <code>r</code> resets accumulation.</div>
`;
main.appendChild(header);

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const nav = document.createElement('nav');
nav.className = 'sections';
nav.innerHTML = gallerySections
    .map((s) => `<a href="#${slug(s.title)}">${s.title}</a>`)
    .join('');
main.appendChild(nav);

const kindChips = (id: string, entry: AnySceneSuiteEntry): string => {
    const chips: string[] = [];
    if (isAsyncSceneEntry(entry)) chips.push('<span class="chip data">data</span>');
    else if (id in demoSuite) chips.push('<span class="chip demo">demo</span>');
    else if (entry.witness) chips.push('<span class="chip gated">gated ✓</span>');
    else chips.push('<span class="chip">witness</span>');
    if (entry.strategies.length > 1) chips.push(`<span class="chip">keys 1–${entry.strategies.length}</span>`);
    return chips.join('');
};

for (const sectionSpec of gallerySections) {
    const section = document.createElement('section');
    section.className = 'group';
    const rowCount = sectionSpec.entries.length;
    section.innerHTML = `
        <h2 id="${slug(sectionSpec.title)}">${sectionSpec.title} <span class="count">· ${rowCount}</span></h2>
        <div class="blurb">${sectionSpec.blurb}</div>
    `;

    for (const { id, partners } of sectionSpec.entries) {
        const entry = sceneSuite[id];
        const name = isAsyncSceneEntry(entry) ? entry.name : entry.scene.name;
        const teaser = entry.exercises.replace(/^DEMO — /, '');
        const strategies = entry.strategies
            .map((s, i) => `${i + 1}: ${s.id}${s.estimator.lightSelection ? ` (${s.estimator.lightSelection})` : ''}`)
            .join('   ');
        const partnerLinks = (partners ?? [])
            .map((p) => `<a href="lab.html?scene=${encodeURIComponent(p)}">${p}</a>`)
            .join(', ');

        const row = document.createElement('details');
        row.className = 'row';
        row.innerHTML = `
            <summary>
                <span class="name"><a href="lab.html?scene=${encodeURIComponent(id)}">${name}</a></span>
                <span class="id">${id}</span>
                ${kindChips(id, entry)}
                <span class="teaser">${teaser}</span>
            </summary>
            <div class="body">
                <div class="strategies">${strategies}</div>
                <p class="exercises">${entry.exercises}</p>
                ${entry.expected ? `<div class="expected"><b>Expect:</b> ${entry.expected}</div>` : ''}
                ${partnerLinks ? `<div class="partners">ref arm: ${partnerLinks}</div>` : ''}
            </div>
        `;
        section.appendChild(row);
    }
    main.appendChild(section);
}
