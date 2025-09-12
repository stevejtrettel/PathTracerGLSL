// src/plugins/controls/KeyboardControl.ts
import type {
    Plugin, Role, PipelineContext, ParameterDescriptor, ParameterView
} from "../../core/types";

/** Logical actions → KeyboardEvent.code (not key, not keyCode). */
export type KeyMap = {
    forward: string;  back: string;   left: string;   right: string;  up: string;   down: string;
    yawL: string;     yawR: string;   pitchU: string; pitchD: string; rollL: string; rollR: string;
    boost: string;    slow: string;   stabilize: string;
};

export interface KeyboardControlOptions {
    /** Element to attach listeners to (canvas or container). If omitted, we still mirror to window. */
    attachTo?: HTMLElement;
    /** Replace any subset of the keymap. */
    keymap?: Partial<KeyMap>;
    /** If true, preventDefault on handled keys when focused on attachTo. */
    preventDefault?: boolean;
}

// /** Default WASD/QE + arrows. Easy to override per your taste. */
// export const DefaultKeyMap: KeyMap = {
//     forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD", up: "KeyE", down: "KeyQ",
//     yawL: "ArrowLeft", yawR: "ArrowRight", pitchU: "ArrowUp", pitchD: "ArrowDown",
//     rollL: "BracketLeft", rollR: "BracketRight",
//     boost: "ShiftLeft", slow: "ControlLeft", stabilize: "KeyR",
// };


/** Default: WASD+QE for rotation, Arrow keys + '/ for translation */
export const DefaultKeyMap: KeyMap = {
    // Translation (arrows + quote/slash)
    forward: "ArrowUp",      // move forward
    back:    "ArrowDown",    // move backward
    left:    "ArrowLeft",    // strafe left
    right:   "ArrowRight",   // strafe right
    up:      "Quote",        // move up ( ' key, code = "Quote")
    down:    "Slash",        // move down ( / key, code = "Slash")

    // Rotation (WASD + QE)
    yawL:    "KeyA",         // turn left
    yawR:    "KeyD",         // turn right
    pitchU:  "KeyW",         // look up
    pitchD:  "KeyS",         // look down
    rollL:   "KeyQ",         // roll counter-clockwise
    rollR:   "KeyE",         // roll clockwise

    // Modifiers
    boost:   "ShiftLeft",    // speed boost
    slow:    "ControlLeft",  // slow mode
    stabilize: "KeyR",       // re-orthonormalize
};


export default class KeyboardControl implements Plugin {
    readonly role: Role = "controls";
    readonly namespace = "ctrl.keyboard";

    private el?: HTMLElement;
    private pressed = new Set<string>();

    private keymap: KeyMap = { ...DefaultKeyMap };
    private preventDefault = true;

    // Parameters (synced via ParameterManager)
    private enabled = true;
    private moveSpeed = 3.0;        // world units per second
    private rotSpeedDeg = 120;      // degrees per second
    private boostFactor = 3.0;
    private slowFactor = 0.35;
    private invertY = false;
    private rollEnabled = true;
    private smoothing = 0.0;        // 0 = off; otherwise LERP rate per second

    // Smoothed intents (optional)
    private smLocal = { x: 0, y: 0, z: 0 };
    private smAng   = { x: 0, y: 0, z: 0 };

    constructor(opts: KeyboardControlOptions = {}) {
        if (opts.keymap) this.keymap = { ...DefaultKeyMap, ...opts.keymap };
        if (opts.preventDefault) this.preventDefault = true;
        if (opts.attachTo) this.attach(opts.attachTo);
    }

    // -------- Parameters (UI-friendly) ---------------------------------------

    parameters(): ParameterDescriptor[] {
        return [
            { name: "enabled",     type: "boolean", default: this.enabled, group: "Controls" },
            { name: "moveSpeed",   type: "float",   default: this.moveSpeed,   min: 0,    max: 50,  step: 0.1, group: "Controls", uiHint: "slider" },
            { name: "rotSpeed",    type: "angle",   default: this.rotSpeedDeg, min: 10,   max: 360, step: 1,   group: "Controls", uiHint: "slider", unit: "deg/s" },
            { name: "boostFactor", type: "float",   default: this.boostFactor, min: 1,    max: 10,  step: 0.1, group: "Controls", uiHint: "slider" },
            { name: "slowFactor",  type: "float",   default: this.slowFactor,  min: 0.05, max: 1,   step: 0.05,group: "Controls", uiHint: "slider" },
            { name: "invertY",     type: "boolean", default: this.invertY,     group: "Controls" },
            { name: "rollEnabled", type: "boolean", default: this.rollEnabled, group: "Controls" },
            { name: "smoothing",   type: "float",   default: this.smoothing,   min: 0,    max: 15,  step: 0.5, group: "Controls", uiHint: "slider" },
        ];
    }

    applyParameters(view: ParameterView): void {
        if (view.has("enabled")) {
            const next = !!view.get("enabled");
            if (next !== this.enabled) {
                this.enabled = next;
                if (!this.enabled) this.pressed.clear(); // avoid stale movement on re-enable
            }
        }
        if (view.has("moveSpeed"))   this.moveSpeed   = +view.get("moveSpeed");
        if (view.has("rotSpeed"))    this.rotSpeedDeg = +view.get("rotSpeed");
        if (view.has("boostFactor")) this.boostFactor = +view.get("boostFactor");
        if (view.has("slowFactor"))  this.slowFactor  = +view.get("slowFactor");
        if (view.has("invertY"))     this.invertY     = !!view.get("invertY");
        if (view.has("rollEnabled")) this.rollEnabled = !!view.get("rollEnabled");
        if (view.has("smoothing"))   this.smoothing   = +view.get("smoothing");
    }

    // -------- Plugin plumbing (no GLSL) --------------------------------------

    uniforms() { return []; }
    chunks()   { return []; }

    /** Attach listeners now or later (Tracer auto-attaches if plugin exposes attach()). */
    attach(el: HTMLElement): void {
        this.detach();
        this.el = el;

        // Make sure it can receive focus so Arrow keys work when canvas is focused.
        if (this.el.tabIndex === undefined || this.el.tabIndex < 0) this.el.tabIndex = 0;

        this.el.addEventListener("keydown", this.onDown, { passive: true });
        this.el.addEventListener("keyup",   this.onUp,   { passive: true });

        // Mirror to window as a safety net, in case focus is lost.
        window.addEventListener("keydown", this.onDown, { passive: true });
        window.addEventListener("keyup",   this.onUp,   { passive: true });
    }

    /** Detach listeners. */
    detach(): void {
        const el = this.el;
        if (el) {
            el.removeEventListener("keydown", this.onDown as any);
            el.removeEventListener("keyup",   this.onUp as any);
        }
        window.removeEventListener("keydown", this.onDown as any);
        window.removeEventListener("keyup",   this.onUp as any);
        this.el = undefined;
        this.pressed.clear();
    }

    /** Swap the entire keymap at runtime, or override individual bindings. */
    setKeyMap(map: Partial<KeyMap> | KeyMap): void {
        const next = ("forward" in map && "back" in map) ? (map as KeyMap) : { ...this.keymap, ...(map as Partial<KeyMap>) };
        this.keymap = next;
    }

    /** Read intent → apply to geometry frame via runtime.moveLocal / rotateLocal. */
    update(ctx: PipelineContext, dt: number): void {
        if (!this.enabled) return;

        const geo = ctx.geometry;
        if (!geo) return;

        const { runtime, frame } = geo;
        const km = this.keymap;

        // --- Build local translation intent (right, up, forward)
        const local = { x: 0, y: 0, z: 0 };
        if (this.pressed.has(km.forward)) local.z += 1;
        if (this.pressed.has(km.back))    local.z -= 1;
        if (this.pressed.has(km.right))   local.x += 1;
        if (this.pressed.has(km.left))    local.x -= 1;
        if (this.pressed.has(km.up))      local.y += 1;
        if (this.pressed.has(km.down))    local.y -= 1;

        // Normalize diagonals
        const L = Math.hypot(local.x, local.y, local.z) || 1;
        local.x /= L; local.y /= L; local.z /= L;

        // --- Angular intent (pitch=x, yaw=y, roll=z)
        const ang = { x: 0, y: 0, z: 0 };
        if (this.pressed.has(km.yawL))   ang.y -= 1;
        if (this.pressed.has(km.yawR))   ang.y += 1;
        if (this.pressed.has(km.pitchU)) ang.x += (this.invertY ? -1 : 1);
        if (this.pressed.has(km.pitchD)) ang.x -= (this.invertY ? -1 : 1);
        if (this.rollEnabled) {
            if (this.pressed.has(km.rollL)) ang.z -= 1;
            if (this.pressed.has(km.rollR)) ang.z += 1;
        }

        // --- Speed modifiers
        let moveSpeed = this.moveSpeed;
        let rotSpeed  = (this.rotSpeedDeg * Math.PI) / 180;
        if (this.pressed.has(km.boost)) { moveSpeed *= this.boostFactor; rotSpeed *= 1.5; }
        if (this.pressed.has(km.slow))  { moveSpeed *= this.slowFactor;  rotSpeed *= 0.5; }

        // Optional smoothing (critically damped-ish simple lerp by rate * dt)
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

        if (this.pressed.has(km.stabilize)) runtime.stabilize?.(frame);
    }

    // -------- Event handlers --------------------------------------------------

    private onDown = (e: KeyboardEvent) => {
        this.pressed.add(e.code);
        if (this.preventDefault && this.el && (e.target === this.el || this.el.contains(e.target as Node))) {
            const handled = this.isHandledCode(e.code);
            if (handled) e.preventDefault();
        }
    };

    private onUp = (e: KeyboardEvent) => {
        this.pressed.delete(e.code);
        if (this.preventDefault && this.el && (e.target === this.el || this.el.contains(e.target as Node))) {
            const handled = this.isHandledCode(e.code);
            if (handled) e.preventDefault();
        }
    };

    private isHandledCode(code: string): boolean {
        const km = this.keymap;
        return code === km.forward || code === km.back || code === km.left || code === km.right ||
            code === km.up || code === km.down ||
            code === km.yawL || code === km.yawR || code === km.pitchU || code === km.pitchD ||
            code === km.rollL || code === km.rollR ||
            code === km.boost || code === km.slow || code === km.stabilize;
    }
}
