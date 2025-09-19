import type {
    Plugin, Role, PipelineContext, ParameterDescriptor, ParameterView, Vec3
} from "../../core/types";

/**
 * Trackball/orbit controls around a target point.
 * Left-drag: orbit (yaw/pitch)
 * Right-drag (or Ctrl+Left): pan
 * Wheel: zoom (change distance)
 */
export default class OrbitControls implements Plugin {
    readonly role: Role = "controls";
    readonly namespace = "ctrl.orbit";

    private el?: HTMLElement;

    // params/state
    private enabled = true;
    private target: Vec3 = { x: 0, y: 0, z: 0 };
    private distance = 6.0;
    private minDistance = 0.5;
    private maxDistance = 100.0;

    private yaw = 0;    // radians, around world/up-ish (we’ll use local frame up)
    private pitch = 0;  // radians, around camera right
    private invertY = false;

    private orbitSensitivityDegPerPx = 0.25;
    private panPerPx = 0.01;     // world units per pixel
    private zoomPerWheel = 1.1;  // multiplicative

    // damping
    private damping = 0.0;
    private vYaw = 0;
    private vPitch = 0;
    private vPan = { x: 0, y: 0 };
    private vZoom = 0;

    // interaction
    private dragging = false;
    private panning = false;
    private lastX = 0;
    private lastY = 0;

    /* ---------------- Plugin meta (no GLSL) ---------------- */
    uniforms() { return []; }
    chunks()   { return []; }

    parameters(): ParameterDescriptor[] {
        return [
            { name: "enabled", type: "boolean", default: this.enabled, group: "Controls" },
            { name: "target",  type: "vec3",    default: [this.target.x, this.target.y, this.target.z], group: "Controls" },
            { name: "distance", type: "float",  default: this.distance, min: 0.01, max: 500, step: 0.01, group: "Controls", uiHint: "slider" },
            { name: "minDistance", type: "float", default: this.minDistance, min: 0.01, max: 10, step: 0.01, group: "Controls" },
            { name: "maxDistance", type: "float", default: this.maxDistance, min: 1, max: 1000, step: 1, group: "Controls" },
            { name: "invertY", type: "boolean", default: this.invertY, group: "Controls" },
            { name: "orbitSensitivity", type: "float", default: this.orbitSensitivityDegPerPx, min: 0.01, max: 2, step: 0.01, group: "Controls" },
            { name: "panPerPx", type: "float", default: this.panPerPx, min: 0.001, max: 0.1, step: 0.001, group: "Controls" },
            { name: "zoomPerWheel", type: "float", default: this.zoomPerWheel, min: 1.02, max: 2, step: 0.01, group: "Controls" },
            { name: "damping", type: "float", default: this.damping, min: 0, max: 20, step: 0.5, group: "Controls" },
        ];
    }

    applyParameters(view: ParameterView): void {
        if (view.has("enabled")) this.enabled = !!view.get("enabled");
        if (view.has("distance")) this.distance = +view.get("distance");
        if (view.has("minDistance")) this.minDistance = +view.get("minDistance");
        if (view.has("maxDistance")) this.maxDistance = +view.get("maxDistance");
        if (view.has("invertY")) this.invertY = !!view.get("invertY");
        if (view.has("orbitSensitivity")) this.orbitSensitivityDegPerPx = +view.get("orbitSensitivity");
        if (view.has("panPerPx")) this.panPerPx = +view.get("panPerPx");
        if (view.has("zoomPerWheel")) this.zoomPerWheel = +view.get("zoomPerWheel");
        if (view.has("damping")) this.damping = +view.get("damping");

        if (view.has("target")) {
            const t = view.get("target");
            if (Array.isArray(t) && t.length === 3) {
                this.target = { x: +t[0], y: +t[1], z: +t[2] };
            }
        }
    }

    /* ---------------- Lifecycle ---------------- */
    attach(el: HTMLElement): void {
        this.detach();
        this.el = el;
        if (this.el.tabIndex === undefined || this.el.tabIndex < 0) this.el.tabIndex = 0;

        this.el.addEventListener("mousedown", this.onMouseDown);
        window.addEventListener("mousemove", this.onMouseMove, { passive: true });
        window.addEventListener("mouseup", this.onMouseUp, { passive: true });
        this.el.addEventListener("wheel", this.onWheel, { passive: false }); // preventDefault to stop page scroll
        // context menu suppression during drag
        this.el.addEventListener("contextmenu", (e) => { if (this.dragging || this.panning) e.preventDefault(); });
    }

    detach(): void {
        if (this.el) {
            this.el.removeEventListener("mousedown", this.onMouseDown as any);
            this.el.removeEventListener("wheel", this.onWheel as any);
        }
        window.removeEventListener("mousemove", this.onMouseMove as any);
        window.removeEventListener("mouseup", this.onMouseUp as any);
        this.el = undefined;
    }

    /* ---------------- Runtime ---------------- */
    update(ctx: PipelineContext, dt: number): void {
        if (!this.enabled || !ctx.geometry) return;
        const { runtime, frame } = ctx.geometry;

        // apply damping to velocities
        const damp = Math.min(1, (this.damping || 0) * dt);
        this.yaw   += this.vYaw   * dt; this.vYaw   -= this.vYaw   * damp;
        this.pitch += this.vPitch * dt; this.vPitch -= this.vPitch * damp;

        // clamp pitch to avoid flipping (just below +/- 90°)
        const maxPitch = Math.PI / 2 - 1e-3;
        this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

        // distance damping via vZoom (log space for smoother multiplicative zoom)
        if (this.vZoom !== 0) {
            const scale = Math.exp(this.vZoom * dt);
            this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance * scale));
            this.vZoom -= this.vZoom * damp;
        }

        // pan damping
        if (this.vPan.x !== 0 || this.vPan.y !== 0) {
            // pan along camera right/up
            const panX = this.vPan.x * dt;
            const panY = this.vPan.y * dt;
            this.vPan.x -= this.vPan.x * damp;
            this.vPan.y -= this.vPan.y * damp;

            // move target in current frame basis
            const r = frame.r, u = frame.u;
            this.target.x += r.x * panX + u.x * panY;
            this.target.y += r.y * panX + u.y * panY;
            this.target.z += r.z * panX + u.z * panY;
        }

        // rebuild frame from yaw/pitch around target:
        // forward = -viewDir (from camera to target)
        const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);

        // camera position in target-centered coordinates
        const dx =  cp * sy;
        const dy =  sp;
        const dz =  cp * cy;

        const camPos: Vec3 = {
            x: this.target.x + dx * this.distance,
            y: this.target.y + dy * this.distance,
            z: this.target.z + dz * this.distance,
        };

        // frame vectors
        frame.p = camPos;
        // forward points from camera to target
        frame.f = { x: this.target.x - camPos.x, y: this.target.y - camPos.y, z: this.target.z - camPos.z };
        // construct right as cross(f, worldUp≈(0,1,0)), then up = cross(r, f)
        // (runtime.stabilize() will orthonormalize)
        const worldUp = { x: 0, y: 1, z: 0 };
        // r = f × up
        const rx = frame.f.y * worldUp.z - frame.f.z * worldUp.y;
        const ry = frame.f.z * worldUp.x - frame.f.x * worldUp.z;
        const rz = frame.f.x * worldUp.y - frame.f.y * worldUp.x;
        frame.r = { x: rx, y: ry, z: rz };
        // u = r × f
        const ux = frame.r.y * frame.f.z - frame.r.z * frame.f.y;
        const uy = frame.r.z * frame.f.x - frame.r.x * frame.f.z;
        const uz = frame.r.x * frame.f.y - frame.r.y * frame.f.x;
        frame.u = { x: ux, y: uy, z: uz };

        runtime.stabilize?.(frame);
    }

    /* ---------------- Handlers ---------------- */
    private onMouseDown = (e: MouseEvent) => {
        if (!this.el) return;
        this.dragging = (e.button === 0);
        this.panning  = (e.button === 2) || (e.button === 0 && (e.ctrlKey || e.metaKey));
        this.lastX = e.clientX;
        this.lastY = e.clientY;
    };

    private onMouseMove = (e: MouseEvent) => {
        if (!this.enabled || (!this.dragging && !this.panning)) return;

        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;

        if (this.dragging) {
            const signY = this.invertY ? 1 : -1;
            const dyaw   =  (dx * this.orbitSensitivityDegPerPx) * Math.PI / 180;
            const dpitch = (dy * this.orbitSensitivityDegPerPx * signY) * Math.PI / 180;
            // apply immediately or via damping velocities
            if (this.damping > 0) {
                this.vYaw   += dyaw * this.damping;
                this.vPitch += dpitch * this.damping;
            } else {
                this.yaw   += dyaw;
                this.pitch += dpitch;
            }
        } else if (this.panning) {
            const panX = dx * this.panPerPx;
            const panY = dy * this.panPerPx * -1; // screen up is -Y
            if (this.damping > 0) {
                this.vPan.x += panX * this.damping;
                this.vPan.y += panY * this.damping;
            } else {
                this.vPan.x += panX;
                this.vPan.y += panY;
            }
        }
    };

    private onMouseUp = () => {
        this.dragging = false;
        this.panning = false;
    };

    private onWheel = (e: WheelEvent) => {
        if (!this.enabled) return;
        // prevent page scroll if interacting with canvas
        e.preventDefault();
        const dir = e.deltaY > 0 ? this.zoomPerWheel : (1 / this.zoomPerWheel);
        const logDelta = Math.log(dir);
        if (this.damping > 0) {
            this.vZoom += logDelta * this.damping;
        } else {
            this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance * Math.exp(logDelta)));
        }
    };
}
