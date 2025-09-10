// src/main.ts
import Tracer from "./tracer/Tracer";
import fullscreenVert from "./glsl/fullscreen.vert.glsl";

import { createEuclideanModule } from "./geometry/Euclidean/EuclideanModule";

import PinholeCameraPlugin from "./camera/PinholeCamera";
import SceneSDFDemoPlugin from "./scene/SceneSDFDemoPlugin";
import NormalsIntegrator from "./integration/NormalsIntegrator";
import SRGBDisplayPlugin from "./display/SRGBDisplay";
import RayDirDebug from "./integration/RayDirDebug";
import LambertIntegrator from "./integration/LambertIntegrator";


const canvas = document.createElement("canvas");
document.body.style.margin = "0";
Object.assign(canvas.style, { width: "100vw", height: "100vh", display: "block" });
document.body.appendChild(canvas);

const tracer = new Tracer({ canvas, vertexSrc: fullscreenVert });

// --- Geometry module: shader + runtime frame in context ---
const { module: geo, frame } = createEuclideanModule();
tracer.use(geo.shader); // shader half
tracer.setContext({ geometry: { runtime: geo.runtime, frame } }); // runtime+frame

// --- Register the rest of the pipeline
tracer
    .use(new PinholeCameraPlugin({ fovYDeg: 60 }))
    .use(new SceneSDFDemoPlugin())     // provides scene.sdf
    .use(new LambertIntegrator())      // provides integrator.integrate
    .use(new SRGBDisplayPlugin())      // display.display
    .build();                                     // build after all .use()

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
