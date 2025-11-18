// app/extensions/KeyboardControls.ts
import type { Extension } from '../types';
import { buildFrame } from '../../../research/optics/camera/utils/buildFrame';
import { AnimationLoop } from '../utils/AnimationLoop';
import { EventManager } from '../utils/EventManager';

/**
 * KeyboardControls - 6DOF camera controls
 *
 * Translation (arrow keys + ' /)
 *   ↑ - forward    ↓ - backward
 *   ← - left       → - right
 *   ' - up         / - down
 *
 * Rotation (WASD + QE)
 *   W - pitch up   S - pitch down
 *   A - yaw left   D - yaw right
 *   Q - roll left  E - roll right
 *
 * Modifiers
 *   Shift - boost (3x speed)
 *   Ctrl  - slow (0.3x speed)
 *   R     - stabilize (align with world up)
 */
class KeyboardControls implements Extension {
    name = 'keyboard-control';
    version = '1.0.0';
    description = '6DOF keyboard camera controls';

    private app: any;
    private bus: any;

    // Camera state
    private position: [number, number, number] = [0, 0, 5];
    private frame: Frame;

    // Input state
    private pressed = new Set<string>();

    // Settings
    private moveSpeed = 1.0;
    private rotSpeed = Math.PI / 10;
    private boostFactor = 3.0;
    private slowFactor = 0.3;

    // Utilities
    private loop = new AnimationLoop();
    private events = new EventManager();

    install(app: any, bus: any): void {
        this.app = app;
        this.bus = bus;

        app.registerService('camera', this);

        this.initializeFromParameters();

        this.events.add(window, 'keydown', this.onKeyDown);
        this.events.add(window, 'keyup', this.onKeyUp);

        this.loop.start((dt) => this.update(dt));
    }

    uninstall(): void {
        this.loop.stop();
        this.events.removeAll();
    }

    // ============================================================================
    // Public API
    // ============================================================================

    getPosition(): [number, number, number] {
        return [...this.position];
    }

    getFrame(): Float32Array {
        return this.frame.toFloat32Array();
    }

    // ============================================================================
    // Private: Initialization
    // ============================================================================

    private initializeFromParameters(): void {
        const pos = this.app.parameterStore.get('camera.position');
        if (pos) {
            this.position = [pos[0], pos[1], pos[2]];
        }

        const target = this.app.parameterStore.get('camera.target');
        if (target) {
            const frameArray = buildFrame(this.position, target);
            this.frame = Frame.fromFloat32Array(frameArray);
            this.app.parameterStore.set('camera.frame', frameArray);
        } else {
            this.frame = new Frame(
                [1, 0, 0],
                [0, 1, 0],
                [0, 0, 1]
            );
        }
    }

    // ============================================================================
    // Private: Update Loop
    // ============================================================================

    private update(dt: number): void {
        if (dt <= 0 || dt > 0.1) return;

        let changed = false;

        let moveSpeed = this.moveSpeed;
        let rotSpeed = this.rotSpeed;

        if (this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight')) {
            moveSpeed *= this.boostFactor;
            rotSpeed *= 1.5;
        }
        if (this.pressed.has('ControlLeft') || this.pressed.has('ControlRight')) {
            moveSpeed *= this.slowFactor;
            rotSpeed *= 0.5;
        }

        const movement = this.getMovementInput();
        if (movement) {
            this.moveLocal(movement, moveSpeed * dt);
            changed = true;
        }

        const rotation = this.getRotationInput();
        if (rotation) {
            this.rotateLocal(rotation, rotSpeed * dt);
            changed = true;
        }

        if (this.pressed.has('KeyR')) {
            this.frame.stabilize();
            changed = true;
        }

        if (changed) {
            this.frame.orthonormalize();
            this.updateParameters();
        }
    }

    // ============================================================================
    // Private: Input
    // ============================================================================

    private getMovementInput(): Vec3 | null {
        const move: Vec3 = [0, 0, 0];

        if (this.pressed.has('ArrowUp')) move[2] -= 1;
        if (this.pressed.has('ArrowDown')) move[2] += 1;
        if (this.pressed.has('ArrowRight')) move[0] += 1;
        if (this.pressed.has('ArrowLeft')) move[0] -= 1;
        if (this.pressed.has('Quote')) move[1] += 1;
        if (this.pressed.has('Slash')) move[1] -= 1;

        return vec3IsZero(move) ? null : vec3Normalize(move);
    }

    private getRotationInput(): Vec3 | null {
        const rot: Vec3 = [0, 0, 0];

        if (this.pressed.has('KeyW')) rot[0] -= 1;
        if (this.pressed.has('KeyS')) rot[0] += 1;
        if (this.pressed.has('KeyA')) rot[1] -= 1;
        if (this.pressed.has('KeyD')) rot[1] += 1;
        if (this.pressed.has('KeyQ')) rot[2] += 1;
        if (this.pressed.has('KeyE')) rot[2] -= 1;

        return vec3IsZero(rot) ? null : vec3Normalize(rot);
    }

    // ============================================================================
    // Private: Movement & Rotation
    // ============================================================================

    private moveLocal(direction: Vec3, distance: number): void {
        const worldDir = this.frame.localToWorld(direction);

        this.position[0] += worldDir[0] * distance;
        this.position[1] += worldDir[1] * distance;
        this.position[2] += worldDir[2] * distance;
    }

    private rotateLocal(rotation: Vec3, angle: number): void {
        const [pitch, yaw, roll] = rotation;

        if (pitch !== 0) this.frame.rotatePitch(pitch * angle);
        if (yaw !== 0) this.frame.rotateYaw(yaw * angle);
        if (roll !== 0) this.frame.rotateRoll(roll * angle);
    }

    private updateParameters(): void {
        this.app.parameterStore.set('camera.position', [...this.position]);
        this.app.parameterStore.set('camera.frame', this.frame.toFloat32Array());

        this.bus.emit('camera.moved', {
            position: this.position,
            frame: this.frame.toFloat32Array()
        });
    }

    // ============================================================================
    // Private: Event Handlers
    // ============================================================================

    private onKeyDown = (e: KeyboardEvent): void => {
        this.pressed.add(e.code);
    };

    private onKeyUp = (e: KeyboardEvent): void => {
        this.pressed.delete(e.code);
    };
}

// ============================================================================
// Frame Helper Class
// ============================================================================

type Vec3 = [number, number, number];

class Frame {
    right: Vec3;
    up: Vec3;
    forward: Vec3;

    constructor(right: Vec3, up: Vec3, forward: Vec3) {
        this.right = right;
        this.up = up;
        this.forward = forward;
    }

    static fromFloat32Array(arr: Float32Array): Frame {
        return new Frame(
            [arr[0], arr[1], arr[2]],
            [arr[3], arr[4], arr[5]],
            [arr[6], arr[7], arr[8]]
        );
    }

    toFloat32Array(): Float32Array {
        return new Float32Array([
            ...this.right,
            ...this.up,
            ...this.forward
        ]);
    }

    localToWorld(local: Vec3): Vec3 {
        return [
            this.right[0] * local[0] + this.up[0] * local[1] + this.forward[0] * local[2],
            this.right[1] * local[0] + this.up[1] * local[1] + this.forward[1] * local[2],
            this.right[2] * local[0] + this.up[2] * local[1] + this.forward[2] * local[2]
        ];
    }

    rotatePitch(angle: number): void {
        this.up = rotateVector(this.up, this.right, angle);
        this.forward = rotateVector(this.forward, this.right, angle);
    }

    rotateYaw(angle: number): void {
        this.right = rotateVector(this.right, this.up, angle);
        this.forward = rotateVector(this.forward, this.up, angle);
    }

    rotateRoll(angle: number): void {
        this.right = rotateVector(this.right, this.forward, angle);
        this.up = rotateVector(this.up, this.forward, angle);
    }

    orthonormalize(): void {
        this.forward = vec3Normalize(this.forward);
        this.right = vec3Normalize(vec3Cross(this.forward, this.up));
        this.up = vec3Cross(this.right, this.forward);
    }

    stabilize(): void {
        const worldUp: Vec3 = [0, 1, 0];
        this.right = vec3Normalize(vec3Cross(this.forward, worldUp));
        this.up = vec3Cross(this.right, this.forward);
    }
}

// ============================================================================
// Vector Math Helpers
// ============================================================================

function vec3Normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (len === 0) return [0, 0, 1];
    return [v[0] / len, v[1] / len, v[2] / len];
}

function vec3Cross(a: Vec3, b: Vec3): Vec3 {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

function vec3IsZero(v: Vec3): boolean {
    return v[0] === 0 && v[1] === 0 && v[2] === 0;
}

function rotateVector(v: Vec3, axis: Vec3, angle: number): Vec3 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;

    const dot = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
    const cross = vec3Cross(axis, v);

    return [
        v[0] * c + cross[0] * s + axis[0] * dot * t,
        v[1] * c + cross[1] * s + axis[1] * dot * t,
        v[2] * c + cross[2] * s + axis[2] * dot * t
    ];
}

export { KeyboardControls };
