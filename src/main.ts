// src/main.ts
import Tracer from "./tracer/Tracer";
import fullscreenVert from "./glsl/fullscreen.vert.glsl";

import { createEuclideanModule } from "./geometry/Euclidean/EuclideanModule";

import PinholeCamera from "./camera/PinholeCamera";
import ThinLensCamera from "./camera/ThinLensCamera";
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
    .use(new PinholeCamera({
        fovYDeg: 60,
        parameters: ['fov']  // Enable FOV as a parameter
    }))
    //.use(new PinholeCameraPlugin({ fovYDeg: 60 }))
    .use(new SceneSDFDemoPlugin())     // provides scene.sdf
    //.use(new NormalIntegrator())      // provides integrator.integrate
    .use(new LambertIntegrator({ animate: true, speed: 0.6, elevationY: 0.7 }))
    .use(new SRGBDisplayPlugin())      // display.display
    .build();// build after all .use()



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



// Create a simple slider
const slider = document.createElement('input');
slider.type = 'range';
slider.min = '10';
slider.max = '120';
slider.value = '60';
slider.style.position = 'fixed';
slider.style.top = '20px';
slider.style.left = '20px';
slider.style.width = '200px';
document.body.appendChild(slider);

const label = document.createElement('div');
label.style.position = 'fixed';
label.style.top = '50px';
label.style.left = '20px';
label.style.color = 'white';
label.style.fontFamily = 'monospace';
label.textContent = 'FOV: 60°';
document.body.appendChild(label);

slider.addEventListener('input', () => {
    const fov = parseFloat(slider.value);
    label.textContent = `FOV: ${fov}°`;
    tracer.setParameter('cam.pinhole', 'fov', fov);
});
