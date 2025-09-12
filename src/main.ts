// src/main.ts
import Tracer from "./tracer/Tracer";
import fullscreenVert from "./glsl/fullscreen.vert.glsl";

import { createEuclideanModule } from "./geometry/Euclidean/EuclideanModule";

import PinholeCamera from "./plugins/camera/PinholeCamera";
import SceneSDFDemoPlugin from "./plugins/scene/SceneSDFDemoPlugin";
import SRGBDisplayPlugin from "./plugins/display/SRGBDisplay";

import LambertIntegrator from "./plugins/integrators/LambertIntegrator";
import NormalsIntegrator from "./plugins/integrators/NormalsIntegrator";

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

// --- Base pipeline (production-ish): Pinhole + Scene + Lambert + sRGB ---
tracer
    .use(new PinholeCamera({
        fovYDeg: 60,
        parameters: ["fov"], // expose FOV as parameter
    }))
    .use(new SceneSDFDemoPlugin())              // provides scene.sdf
    .use(new LambertIntegrator({                // base integrator
        animate: true,
        speed: 0.6,
        elevationY: 0.7,
    }))
    .use(new SRGBDisplayPlugin());

// --- Variant (fast): swap only the integrator to Normals ---
tracer.addVariant("fast", {
    integrator: new NormalsIntegrator(),
});

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

// --- Quick keyboard toggle for variants: 1 = base (Lambert), 2 = fast (Normals) ---
window.addEventListener("keydown", (e) => {
    if (e.key === "1") {
        tracer.useVariant(null);        // back to base (Lambert)
        console.log("Variant: base (Lambert)");
    } else if (e.key === "2") {
        tracer.useVariant("fast");      // Normals integrator
        console.log("Variant: fast (Normals)");
    }
});
