// app/extensions/KeyboardControls.ts
import type { App } from '../App.js';
import type { EventBus } from '../EventBus.js';

type Vec3 = [number, number, number];

/**
 * KeyboardControls - 6DOF camera navigation
 *
 * Translation (arrow keys + '/)
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
 *   G     - stabilize (align with world up)
 *
 * Note: This is for 6DOF camera navigation, separate from App's
 * application shortcuts (1-9 for renderers, r for reset, etc.)
 */
export class KeyboardControls {
    name = 'keyboard-controls';
    version = '1.0.0';
    description = '6DOF keyboard camera navigation';

    private app!: App;
    private bus!: EventBus;

    // Camera state
    private position: Vec3 = [0, 0, 8];
    private frame: Frame = new Frame([1, 0, 0], [0, 1, 0], [0, 0, 1]);

    // Input state
    private pressed = new Set<string>();

    // Settings
    private moveSpeed = 2.0;
    private rotSpeed = Math.PI / 8;
    private boostFactor = 3.0;
    private slowFactor = 0.3;

    // Animation loop
    private animationId: number | null = null;
    private lastTime = 0;

    install(app: App, bus: EventBus): void {
        this.app = app;
        this.bus = bus;

        // Initialize from current parameters
        this.initializeFromParameters();

        // Event listeners
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        window.addEventListener('blur', this.onBlur);

        // Start update loop
        this.lastTime = performance.now();
        this.startLoop();

        console.log('KeyboardControls installed:');
        console.log('  Arrows/\'/ : Move');
        console.log('  WASD/QE   : Rotate');
        console.log('  Shift     : Boost');
        console.log('  Ctrl      : Slow');
        console.log('  G         : Stabilize');
    }

    uninstall(): void {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        window.removeEventListener('blur', this.onBlur);
        this.stopLoop();
    }

    // ============================================================================
    // Public API
    // ============================================================================

    getPosition(): Vec3 {
        return [...this.position];
    }

    setPosition(pos: Vec3): void {
        this.position = [...pos];
        this.updateParameters();
    }

    getTarget(): Vec3 {
        // Target is position + forward direction
        return [
            this.position[0] + this.frame.forward[0],
            this.position[1] + this.frame.forward[1],
            this.position[2] + this.frame.forward[2]
        ];
    }

    /**
     * Look at a specific point
     */
    lookAt(target: Vec3): void {
        const dir = vec3Normalize([
            target[0] - this.position[0],
            target[1] - this.position[1],
            target[2] - this.position[2]
        ]);

        // Build frame from direction
        this.frame.forward = dir;
        this.frame.stabilize();
        this.frame.orthonormalize();
        this.updateParameters();
    }

    // ============================================================================
    // Serialization for session save/restore
    // ============================================================================

    saveState(): { position: Vec3; frame: number[] } {
        return {
            position: [...this.position],
            frame: Array.from(this.frame.toFloat32Array())
        };
    }

    restoreState(state: { position: Vec3; frame: number[] }): void {
        if (state.position) {
            this.position = [...state.position];
        }
        if (state.frame) {
            this.frame = Frame.fromFloat32Array(new Float32Array(state.frame));
        }
        this.updateParameters();
    }

    // ============================================================================
    // Private: Initialization
    // ============================================================================

    private initializeFromParameters(): void {
        const pos = this.app.getParameter('camera.position');
        if (pos && Array.isArray(pos)) {
            this.position = [pos[0], pos[1], pos[2]];
        }

        const target = this.app.getParameter('camera.target');
        if (target && Array.isArray(target)) {
            this.lookAt(target);
        }
    }

    // ============================================================================
    // Private: Animation Loop
    // ============================================================================

    private startLoop(): void {
        const update = (now: number) => {
            const dt = (now - this.lastTime) / 1000; // Convert to seconds
            this.lastTime = now;

            this.update(dt);
            this.animationId = requestAnimationFrame(update);
        };

        this.animationId = requestAnimationFrame(update);
    }

    private stopLoop(): void {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    private update(dt: number): void {
        // Clamp dt to avoid huge jumps
        if (dt <= 0 || dt > 0.1) return;

        let changed = false;

        // Speed modifiers
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

        // Movement
        const movement = this.getMovementInput();
        if (movement) {
            this.moveLocal(movement, moveSpeed * dt);
            changed = true;
        }

        // Rotation
        const rotation = this.getRotationInput();
        if (rotation) {
            this.rotateLocal(rotation, rotSpeed * dt);
            changed = true;
        }

        // Stabilize (G key)
        if (this.pressed.has('KeyG')) {
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

        // Forward/backward (arrows or numpad)
        if (this.pressed.has('ArrowUp') || this.pressed.has('Numpad8')) move[2] -= 1;
        if (this.pressed.has('ArrowDown') || this.pressed.has('Numpad2')) move[2] += 1;

        // Left/right
        if (this.pressed.has('ArrowRight') || this.pressed.has('Numpad6')) move[0] += 1;
        if (this.pressed.has('ArrowLeft') || this.pressed.has('Numpad4')) move[0] -= 1;

        // Up/down (' and / keys)
        if (this.pressed.has('Quote')) move[1] += 1;
        if (this.pressed.has('Slash')) move[1] -= 1;

        return vec3IsZero(move) ? null : vec3Normalize(move);
    }

    private getRotationInput(): Vec3 | null {
        const rot: Vec3 = [0, 0, 0];

        // Pitch (W/S)
        if (this.pressed.has('KeyW')) rot[0] -= 1;  // Pitch up
        if (this.pressed.has('KeyS')) rot[0] += 1;  // Pitch down

        // Yaw (A/D)
        if (this.pressed.has('KeyA')) rot[1] -= 1;  // Yaw left
        if (this.pressed.has('KeyD')) rot[1] += 1;  // Yaw right

        // Roll (Q/E)
        if (this.pressed.has('KeyQ')) rot[2] += 1;  // Roll left
        if (this.pressed.has('KeyE')) rot[2] -= 1;  // Roll right

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
        // Update camera position
        this.app.setParameter('camera.position', [...this.position]);

        // Compute target from position + forward
        const target: Vec3 = [
            this.position[0] + this.frame.forward[0] * 5,
            this.position[1] + this.frame.forward[1] * 5,
            this.position[2] + this.frame.forward[2] * 5
        ];
        this.app.setParameter('camera.target', target);

        // Emit event for other systems
        this.bus.emit('camera.moved', {
            position: this.position,
            target,
            frame: this.frame.toFloat32Array()
        });
    }

    // ============================================================================
    // Private: Event Handlers
    // ============================================================================

    private onKeyDown = (e: KeyboardEvent): void => {
        // Skip if typing in input
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
            return;
        }

        this.pressed.add(e.code);
    };

    private onKeyUp = (e: KeyboardEvent): void => {
        this.pressed.delete(e.code);
    };

    private onBlur = (): void => {
        // Clear all pressed keys when window loses focus
        this.pressed.clear();
    };
}

// ============================================================================
// Frame Helper Class - 3D rotation frame
// ============================================================================

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
