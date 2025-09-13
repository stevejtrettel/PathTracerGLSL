// src/main.ts
import Tracer from "./tracer/Tracer";
import fullscreenVert from "./glsl/fullscreen.vert.glsl";

import { createEuclideanModule } from "./geometry/euclidean/EuclideanModule";

import PinholeCamera from "./plugins/camera/PinholeCamera";
import TonemapSRGB from "./plugins/postprocess/TonemapSRGB"

// NEW: first-class scene plugins
import SceneSDFDemo from "./scene/examples/SceneSDFDemo";
import SceneThreeSpheres from "./scene/examples/SceneThreeSpheres";

// Integrators rewritten to call scene_* contract
import NormalsIntegrator from "./integrators/one-shot/NormalsIntegrator";
import LambertIntegrator from "./integrators/one-shot/LambertIntegrator";
import PathTracerMinimal from "./integrators/PathTracerMinimal";

// NEW: keyboard controls (CPU-only updatable/attachable)
import KeyboardControl from "./plugins/controls/KeyboardControl";
import FPSControls from "./plugins/controls/FPSControls";



// --- Canvas bootstrap ---
const canvas = document.createElement("canvas");
document.body.style.margin = "0";
Object.assign(canvas.style, { width: "100vw", height: "100vh", display: "block" });
document.body.appendChild(canvas);

const tracer = new Tracer({ canvas, vertexSrc: fullscreenVert });

// --- Geometry module: shader + runtime frame in context ---
const { module: geo, frame } = createEuclideanModule();
tracer.use(geo.shader); // shader half
tracer.setContext({ geometry: { runtime: geo.runtime, frame } }); // runtime+frame

// --- Plugins (pick base pipeline) ---
// Base = Pinhole + Demo Scene + Lambert + sRGB
const camera = new PinholeCamera({ fovYDeg: 60, parameters: ["fov"] });
const sceneDemo = new SceneSDFDemo();
const sceneTri  = new SceneThreeSpheres();
const lambert   = new LambertIntegrator();
const normals   = new NormalsIntegrator();
const tinypt = new PathTracerMinimal();

// NEW: Controls (auto-attaches to canvas via Tracer; preventDefault for arrows)
// const controls = new FPSControls();
// controls.attach(canvas);
const controls = new KeyboardControl({ preventDefault: true });

tracer
    .use(camera)
    .use(sceneDemo)     // <- default scene at startup
    .use(tinypt)       // <- default integrator at startup
    .use(new TonemapSRGB())
    // NEW: register controls (CPU-only, runs pre-phase)
    .use(controls);

// --- Variants: swap integrator and/or scene ---
tracer.addVariant("fast",           { integrator: lambert });
tracer.addVariant("tri",            { scene: sceneTri });
tracer.addVariant("tri+fast",       { scene: sceneTri, integrator: normals });

// --- Compile base + variants for hot switching ---
tracer.buildAll();

// --- Sizing / loop ---
function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.floor(window.innerWidth  * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    tracer.setSize(canvas.width, canvas.height);
}
window.addEventListener("resize", resize);
resize();

(function loop() {
    tracer.frame();
    requestAnimationFrame(loop);
})();

// --- Simple FOV slider (parameter persists across variants via namespace) ---
const slider = document.createElement("input");
slider.type = "range";
slider.min = "10";
slider.max = "120";
slider.value = "60";
slider.style.position = "fixed";
slider.style.top = "20px";
slider.style.left = "20px";
slider.style.width = "200px";
document.body.appendChild(slider);

const label = document.createElement("div");
label.style.position = "fixed";
label.style.top = "50px";
label.style.left = "20px";
label.style.color = "white";
label.style.fontFamily = "monospace";
label.textContent = "FOV: 60°";
document.body.appendChild(label);

slider.addEventListener("input", () => {
    const fov = parseFloat(slider.value);
    label.textContent = `FOV: ${fov}°`;
    tracer.setParameter("cam.pinhole", "fov", fov);
});

// // --- NEW: Controls Enabled toggle (nice for long renders) ---
// const ctrlToggle = document.createElement("label");
// ctrlToggle.style.position = "fixed";
// ctrlToggle.style.top = "80px";
// ctrlToggle.style.left = "20px";
// ctrlToggle.style.color = "white";
// ctrlToggle.style.fontFamily = "monospace";
//
// const ctrlCheckbox = document.createElement("input");
// ctrlCheckbox.type = "checkbox";
// ctrlCheckbox.checked = true;
// ctrlCheckbox.style.marginRight = "6px";
// ctrlCheckbox.addEventListener("change", () => {
//     tracer.setParameter("ctrl.keyboard", "enabled", ctrlCheckbox.checked);
// });
//
// ctrlToggle.appendChild(ctrlCheckbox);
// ctrlToggle.appendChild(document.createTextNode("Controls Enabled"));
// document.body.appendChild(ctrlToggle);

// --- Keyboard hotkeys: 1=base, 2=fast (normals), 3=tri (Lambert), 4=tri+fast ---
window.addEventListener("keydown", (e) => {
    if (e.key === "1") {
        tracer.useVariant(null);        // base: Demo + Lambert
        console.log("Variant: base (Demo + Lambert)");
    } else if (e.key === "2") {
        tracer.useVariant("fast");      // Demo + Normals
        console.log("Variant: fast (Demo + Normals)");
    } else if (e.key === "3") {
        tracer.useVariant("tri");       // ThreeSpheres + Lambert
        console.log("Variant: tri (ThreeSpheres + Lambert)");
    } else if (e.key === "4") {
        tracer.useVariant("tri+fast");  // ThreeSpheres + Normals
        console.log("Variant: tri+fast (ThreeSpheres + Normals)");
    }
});
