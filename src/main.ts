// in main.ts (engine path)
import Tracer from "./tracer/Tracer";
import fullscreenVert from "./glsl/fullscreen.vert";
import TestIntegratorPlugin from "./integration/TestIntegrator";
import SRGBDisplayPlugin from "./display/SRGBDisplay";

const canvas = document.createElement("canvas");
document.body.style.margin = "0";
Object.assign(canvas.style, { width: "100vw", height: "100vh", display: "block" });
document.body.appendChild(canvas);

const tracer = new Tracer({ canvas, vertexSrc: fullscreenVert });
tracer.use(new TestIntegratorPlugin())
    .use(new SRGBDisplayPlugin())
    .build();

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
