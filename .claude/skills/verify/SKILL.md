---
name: verify
description: Drive the path tracer's lab pages in headless Chromium (WebGL2 via SwiftShader) to verify rendering changes at runtime — screenshots, pixel stats, validator/overlay probes.
---

# Verifying PathTracerGLSL changes at runtime

GPU behavior only surfaces in the browser — vitest never compiles GLSL. The recipe that works:

1. `npm run dev` (background) → port 3000. Scenes at `/lab.html?scene=<id>` (registry in
   `src/compiler/scenes/index.ts`); the gallery at `/`.
2. Playwright chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader` renders
   WebGL2 incl. rgba32f accumulation. Playwright is NOT in the project deps — `npm install
   playwright` in a scratch dir (browsers are already cached in `~/Library/Caches/ms-playwright`).
3. The lab page exposes **`window.app`** after "Ready!" (`await page.waitForFunction(() =>
   window.app !== undefined)`). Handles:
   - `app.setParameters({ 'camera.position': [...], 'camera.target': [...] })` — drive camera/params.
   - `app.recompile(sceneObject)` — the dev-loop surface; a Validator rejection THROWS
     `CompilationError` and shows the `.error-overlay` div (check `display !== 'none'`).
   - Keys `1`-`9` switch renderers (`page.keyboard.press('2')`), `r` resets accumulation.
4. Pixel stats without `preserveDrawingBuffer`: `page.screenshot()` (compositor-level), then
   feed the PNG back into the page as a data-URL image drawn to a 2D canvas → `getImageData`.
   Useful stats: mean luminance, black-pixel fraction.
5. SwiftShader is SLOW (~1-3 fps at 640×480) — 8s ≈ 15-25 samples. Enough for structure,
   NaN/black-frame, and overlay checks; NOT enough for convergence-equality witnesses
   (those are the owner's GPU checks per the suite cards' `expected` text).
6. StatsPanel overlays the top-left corner (samples/FPS/renderer id) — it's IN screenshots;
   crop or ignore that region for pixel stats if precision matters.

A working driver template: see the session scratchpad `verify-hardening.mjs` pattern
(console/pageerror capture, overlay probe, recompile rejection probe, screenshot+stats).
