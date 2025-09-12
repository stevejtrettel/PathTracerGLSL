// src/plugins/controls/FPSControls.ts
import type {
    Plugin, Role, PipelineContext, ParameterDescriptor, ParameterView
} from "../../core/types";

/** Single-code bindings (KeyboardEvent.code) */
export type FPSKeyMap = {
    forward: string; back: string; left: string; right: string;
    up: string; down: string;
    rollL: string; rollR: string;
    boost: string; slow: string;
    pointerLock: string; // optional toggle key
};

export const DefaultFPSKeyMap: FPSKeyMap = {
    forward: "KeyW",
    back:    "KeyS",
    left:    "KeyA",
    right:   "KeyD",
    up:      "Space",
    down:    "KeyC",
    rollL:   "KeyQ",
    rollR:   "KeyE",
    boost:   "ShiftLeft",
    slow:    "ControlLeft",
    pointerLock: "KeyP",
};

export interface FPSControlsOptions {
    keymap?: Partial<FPSKeyMap>;
    /** Block browser scroll/shortcuts on handled keys when focused on canvas. Default: true */
    preventDefault?: boolean;
}

export default class FPSControls implements Plugin {
    readonly role: Role = "controls";
    readonly namespace = "ctrl.fps";

    private el?: HTMLElement;
    private pressed = new Set<string>();
    private keymap: FPSKeyMap = { ...DefaultFPSKeyMap };

    // Default ON; pass { preventDefault:false } to allow page scrolling
    private preventDefault = true;

    // pointer lock / mouse
    private pointerLocked = false;
    private mouseSensitivityDegPerPixel = 0.12;
    private invertY = false;

    // params
    private enabled = true;
    private moveSpeed = 3.0;      // units/s
    private rotSpeedDeg = 180;    // deg/s for keyboard angular input
    private boostFactor = 3.0;
    private slowFactor = 0.35;
    private rollEnabled = true;

    // smoothing (keyboard intents only)
    private smoothing = 0.0; // lerp rate (1/s); 0 = off
    private smLocal = { x: 0, y: 0, z: 0 };
    private smAng   = { x: 0, y: 0, z: 0 };

    // accumulated mouse deltas (radians), applied every frame
    private pendingMouseYaw = 0;   // + right
    private pendingMousePitch = 0; // + up

    constructor(opts: FPSControlsOptions = {}) {
        if (opts.keymap) this.keymap = { ...DefaultFPSKeyMap, ...opts.keymap };
        if (opts.preventDefault === false) this.preventDefault = false;
    }

    /* ---------------- Plugin plumbing (no GLSL) ---------------- */
    uniforms() { return []; }
    chunks()   { return []; }

    parameters(): ParameterDescriptor[] {
        return [
            { name: "enabled",     type: "boolean", default: this.enabled,     group: "Controls" },
            { name: "moveSpeed",   type: "float",   default: this.moveSpeed,   min: 0, max: 50, step: 0.1, group: "Controls", uiHint: "slider" },
            { name: "rotSpeed",    type: "angle",   default: this.rotSpeedDeg, min: 30, max: 720, step: 5, group: "Controls", uiHint: "slider", unit: "deg/s" },
            { name: "boostFactor", type: "float",   default: this.boostFactor, min: 1, max: 10, step: 0.1, group: "Controls", uiHint: "slider" },
            { name: "slowFactor",  type: "float",   default: this.slowFactor,  min: 0.05, max: 1, step: 0.05, group: "Controls", uiHint: "slider" },
            { name: "mouseSensitivity", type: "float", default: this.mouseSensitivityDegPerPixel, min: 0.01, max: 1, step: 0.01, group: "Controls" },
            { name: "invertY",     type: "boolean", default: this.invertY,     group: "Controls" },
            { name: "rollEnabled", type: "boolean", default: this.rollEnabled, group: "Controls" },
            { name: "smoothing",   type: "float",   default: this.smoothing,   min: 0, max: 15, step: 0.5, group: "Controls" },
        ];
    }

    applyParameters(view: ParameterView): void {
        if (view.has("enabled"))     this.enabled = !!view.get("enabled");
        if (view.has("moveSpeed"))   this.moveSpeed = +view.get("moveSpeed");
        if (view.has("rotSpeed"))    this.rotSpeedDeg = +view.get("rotSpeed");
        if (view.has("boostFactor")) this.boostFactor = +view.get("boostFactor");
        if (view.has("slowFactor"))  this.slowFactor = +view.get("slowFactor");
        if (view.has("mouseSensitivity")) this.mouseSensitivityDegPerPixel = +view.get("mouseSensitivity");
        if (view.has("invertY"))     this.invertY = !!view.get("invertY");
        if (view.has("rollEnabled")) this.rollEnabled = !!view.get("rollEnabled");
        if (view.has("smoothing"))   this.smoothing = +view.get("smoothing");
        if (!this.enabled) this.pressed.clear();
    }

    /* ---------------- Lifecycle ---------------- */
    attach(el: HTMLElement): void {
        this.detach();
        this.el = el;
        if (this.el.tabIndex === undefined || this.el.tabIndex < 0) this.el.tabIndex = 0;

        // pointer lock lifecycle
        this.el.addEventListener("click", this.onRequestPointerLock);
        document.addEventListener("pointerlockchange", this.onPointerLockChange);

        // keyboard
        this.el.addEventListener("keydown", this.onKeyDown, { passive: true });
        this.el.addEventListener("keyup",   this.onKeyUp,   { passive: true });
        window.addEventListener("keydown", this.onKeyDown, { passive: true });
        window.addEventListener("keyup",   this.onKeyUp,   { passive: true });

        // mouse (deltas only matter when locked)
        window.addEventListener("mousemove", this.onMouseMove, { passive: true });

        // avoid context menu while locked (or during active drag)
        this.el.addEventListener("contextmenu", (e) => { if (this.pointerLocked) e.preventDefault(); });
    }

    detach(): void {
        if (this.el) {
            this.el.removeEventListener("click", this.onRequestPointerLock as any);
            this.el.removeEventListener("keydown", this.onKeyDown as any);
            this.el.removeEventListener("keyup", this.onKeyUp as any);
            this.el.removeEventListener("contextmenu", this.onContextMenuBlock as any);
        }
        document.removeEventListener("pointerlockchange", this.onPointerLockChange as any);
        window.removeEventListener("keydown", this.onKeyDown as any);
        window.removeEventListener("keyup", this.onKeyUp as any);
        window.removeEventListener("mousemove", this.onMouseMove as any);

        this.el = undefined;
        this.pressed.clear();
        this.pendingMouseYaw = 0;
        this.pendingMousePitch = 0;
        if (document.pointerLockElement) document.exitPointerLock?.();
    }

    /* ---------------- Runtime ---------------- */
    update(ctx: PipelineContext, dt: number): void {
        if (!this.enabled || !ctx.geometry) return;
        const { runtime, frame } = ctx.geometry;
        const km = this.keymap;

        // translation intent (strafe, vertical, forward)
        const local = { x: 0, y: 0, z: 0 };
        if (this.pressed.has(km.forward)) local.z += 1;
        if (this.pressed.has(km.back))    local.z -= 1;
        if (this.pressed.has(km.right))   local.x += 1;
        if (this.pressed.has(km.left))    local.x -= 1;
        if (this.pressed.has(km.up))      local.y += 1;
        if (this.pressed.has(km.down))    local.y -= 1;

        // normalize diagonal
        const L = Math.hypot(local.x, local.y, local.z) || 1;
        local.x /= L; local.y /= L; local.z /= L;

        // keyboard angular intent (pitch=x, yaw=y, roll=z)
        const ang = { x: 0, y: 0, z: 0 };
        if (this.rollEnabled) {
            if (this.pressed.has(km.rollL)) ang.z -= 1;
            if (this.pressed.has(km.rollR)) ang.z += 1;
        }

        // speed modifiers
        let moveSpeed = this.moveSpeed;
        let rotSpeed  = (this.rotSpeedDeg * Math.PI) / 180;
        if (this.pressed.has(km.boost)) { moveSpeed *= this.boostFactor; rotSpeed *= 1.5; }
        if (this.pressed.has(km.slow))  { moveSpeed *= this.slowFactor;  rotSpeed *= 0.5; }

        // 1) Apply keyboard intents (with optional smoothing)
        if (this.smoothing > 0 && dt > 0) {
            const a = Math.min(1, this.smoothing * dt);
            this.smLocal.x += (local.x - this.smLocal.x) * a;
            this.smLocal.y += (local.y - this.smLocal.y) * a;
            this.smLocal.z += (local.z - this.smLocal.z) * a;
            this.smAng.x   += (ang.x   - this.smAng.x)   * a;
            this.smAng.y   += (ang.y   - this.smAng.y)   * a;
            this.smAng.z   += (ang.z   - this.smAng.z)   * a;
            runtime.moveLocal(frame, this.smLocal, moveSpeed, dt);
            runtime.rotateLocal(frame, this.smAng,  rotSpeed, dt);
        } else {
            runtime.moveLocal(frame, local, moveSpeed, dt);
            runtime.rotateLocal(frame, ang,   rotSpeed, dt);
        }

        // 2) Apply accumulated mouse look (radians), independent of smoothing
        if (this.pendingMouseYaw !== 0 || this.pendingMousePitch !== 0) {
            const mouseAng = { x: this.pendingMousePitch, y: this.pendingMouseYaw, z: 0 };
            // Apply in radians directly: use rotSpeed=1 and dt=1 to avoid extra scaling
            runtime.rotateLocal(frame, mouseAng, 1, 1);
            this.pendingMouseYaw = 0;
            this.pendingMousePitch = 0;
        }

        // keep frame tidy
        runtime.stabilize?.(frame);
    }

    /* ---------------- Handlers ---------------- */
    private onRequestPointerLock = () => {
        if (!this.el) return;
        // must be called in a user gesture (click or key)
        this.el.requestPointerLock?.();
    };

    private onPointerLockChange = () => {
        this.pointerLocked = document.pointerLockElement === this.el;
    };

    private onKeyDown = (e: KeyboardEvent) => {
        this.pressed.add(e.code);
        if (!this.el) return;

        if (e.code === this.keymap.pointerLock) this.onRequestPointerLock();

        if (this.preventDefault && (e.target === this.el || this.el.contains(e.target as Node))) {
            if (this.isHandledCode(e.code)) e.preventDefault();
        }
    };

    private onKeyUp = (e: KeyboardEvent) => {
        this.pressed.delete(e.code);
        if (!this.el) return;

        if (this.preventDefault && (e.target === this.el || this.el.contains(e.target as Node))) {
            if (this.isHandledCode(e.code)) e.preventDefault();
        }
    };

    private onMouseMove = (e: MouseEvent) => {
        if (!this.enabled || !this.pointerLocked) return;
        const dx = e.movementX || 0;
        const dy = e.movementY || 0;

        // Convert deltas to radians (yaw right = +, pitch up = +)
        const degX = dx * this.mouseSensitivityDegPerPixel;
        const degY = dy * this.mouseSensitivityDegPerPixel * (this.invertY ? 1 : -1);

        this.pendingMouseYaw   += (degX * Math.PI) / 180;
        this.pendingMousePitch += (degY * Math.PI) / 180;
    };

    private isHandledCode(code: string): boolean {
        const km = this.keymap;
        return code === km.forward || code === km.back || code === km.left || code === km.right ||
            code === km.up || code === km.down || code === km.rollL || code === km.rollR ||
            code === km.boost || code === km.slow || code === km.pointerLock;
    }

    // dummy to match detach removal if contextmenu listener is added separately
    private onContextMenuBlock = (e: Event) => { e.preventDefault(); };
}
