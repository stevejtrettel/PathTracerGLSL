// app/extensions/KeyboardControls.ts
import type { Extension } from '../types';
import {buildFrame} from "../../optics/camera/utils/buildFrame";

/**
 * KeyboardControls provides 6DOF camera controls
 *
 * Translation (arrows + '/)
 *   ↑ - move forward
 *   ↓ - move backward
 *   ← - strafe left
 *   → - strafe right
 *   ' - move up
 *   / - move down
 *
 * Rotation (WASD + QE)
 *   W - pitch up
 *   S - pitch down
 *   A - yaw left
 *   D - yaw right
 *   Q - roll left
 *   E - roll right
 *
 * Modifiers
 *   Shift - boost (3x speed)
 *   Ctrl  - slow (0.3x speed)
 *   R     - stabilize frame
 */
class KeyboardControls implements Extension {
    name = 'keyboard-control';
    version = '1.0.0';
    description = '6DOF keyboard camera controls';

    private app: any;
    private bus: any;

    // Camera state
    private position: [number, number, number] = [0, 0, 5];
    private frame: Float32Array = new Float32Array([
        1, 0, 0,  // right
        0, 1, 0,  // up
        0, 0, 1   // forward
    ]);

    // Key tracking
    private pressed = new Set<string>();

    // Settings
    private moveSpeed = 1.0;           // units per second
    private rotSpeed =  Math.PI / 10;    //  degrees per second
    private boostFactor = 3.0;
    private slowFactor = 0.3;

    // Update loop
    private animationId?: number;
    private lastTime = 0;

    install(app: any, bus: any): void {
        this.app = app;
        this.bus = bus;

        // Register as service
        app.registerService('camera', this);

        // Initialize from current camera state
        this.initializeFromParameters();

        // Setup keyboard listeners
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);

        // Start update loop
        this.lastTime = performance.now();
        this.startUpdateLoop();

        console.log('KeyboardControl extension installed');
        console.log('Controls: Arrows+\'/=move, WASD+QE=rotate, Shift=boost, Ctrl=slow, R=stabilize');
    }

    uninstall(): void {
        // Stop update loop
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }

        // Remove keyboard listeners
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
    }

    // ============================================================================
    // Public API
    // ============================================================================

    getPosition(): [number, number, number] {
        return [...this.position];
    }

    getFrame(): Float32Array {
        return new Float32Array(this.frame);
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
            // Build frame using camera's buildFrame
            this.frame = buildFrame(this.position, target);

            // IMMEDIATELY set it as a parameter to test
            console.log('Setting initial frame:', this.frame);
            this.app.parameterStore.set('camera.frame', new Float32Array(this.frame));
        }
    }

    private buildFrameFromTarget(position: number[], target: number[]): Float32Array {
        return buildFrame(position, target);
    }

    // ============================================================================
    // Private: Update Loop
    // ============================================================================

    private startUpdateLoop(): void {
        const loop = (time: number) => {
            const dt = (time - this.lastTime) / 1000; // Convert to seconds
            this.lastTime = time;

            this.update(dt);

            this.animationId = requestAnimationFrame(loop);
        };

        this.animationId = requestAnimationFrame(loop);
    }

    private update(dt: number): void {
        if (dt <= 0 || dt > 0.1) return; // Skip invalid or huge deltas

        let moved = false;
        let rotated = false;



        // Check for speed modifiers
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

        // --- Translation (in local space) ---
        const moveLocal = [0, 0, 0];

        // Forward/back (arrows) - FIXED
        if (this.pressed.has('ArrowUp'))   moveLocal[2] -= 1;
        if (this.pressed.has('ArrowDown')) moveLocal[2] += 1;

        // Strafe left/right (arrows)
        if (this.pressed.has('ArrowRight')) moveLocal[0] += 1;
        if (this.pressed.has('ArrowLeft'))  moveLocal[0] -= 1;

        // Up/down (' and /)
        if (this.pressed.has('Quote')) moveLocal[1] += 1;
        if (this.pressed.has('Slash')) moveLocal[1] -= 1;

        // Normalize diagonal movement
        const moveLen = Math.sqrt(
            moveLocal[0] * moveLocal[0] +
            moveLocal[1] * moveLocal[1] +
            moveLocal[2] * moveLocal[2]
        );


        if (moveLen > 0) {
            // DEBUG: Log position BEFORE move
            console.log('Position before move:', [...this.position]);

            // Move in local space
            this.moveLocal(moveLocal, moveSpeed * dt);
            moved = true;

            // DEBUG: Log position AFTER move
            console.log('Position after move:', [...this.position]);
        }



        if (moveLen > 0) {
            moveLocal[0] /= moveLen;
            moveLocal[1] /= moveLen;
            moveLocal[2] /= moveLen;

            // Move in local space
            this.moveLocal(moveLocal, moveSpeed * dt);
            moved = true;
        }

        // --- Rotation ---
        const rotation = [0, 0, 0]; // [pitch, yaw, roll]

        // Pitch (W/S)
        if (this.pressed.has('KeyW')) rotation[0] -= 1;
        if (this.pressed.has('KeyS')) rotation[0] += 1;

        // Yaw (A/D)
        if (this.pressed.has('KeyA')) rotation[1] -= 1;
        if (this.pressed.has('KeyD')) rotation[1] += 1;

        // Roll (Q/E)
        if (this.pressed.has('KeyQ')) rotation[2] -= 1;
        if (this.pressed.has('KeyE')) rotation[2] += 1;

        const rotLen = Math.sqrt(
            rotation[0] * rotation[0] +
            rotation[1] * rotation[1] +
            rotation[2] * rotation[2]
        );

        if (rotLen > 0) {
            rotation[0] /= rotLen;
            rotation[1] /= rotLen;
            rotation[2] /= rotLen;

            this.rotateLocal(rotation, rotSpeed * dt);
            rotated = true;
        }

        // Stabilize frame
        if (this.pressed.has('KeyR')) {
            this.stabilizeFrame();
            rotated = true;
        }

        // Update parameters if anything changed
        if (moved || rotated) {
            // Orthonormalize frame to prevent drift
            this.orthonormalizeFrame();
            this.updateParameters();
        }
    }

    // ============================================================================
    // Private: Movement & Rotation
    // ============================================================================

    private moveLocal(direction: number[], distance: number): void {
        // direction is in local space [right, up, forward]
        // Convert to world space using frame

        const right   = [this.frame[0], this.frame[1], this.frame[2]];
        const up      = [this.frame[3], this.frame[4], this.frame[5]];
        const forward = [this.frame[6], this.frame[7], this.frame[8]];

        // World movement = right*x + up*y + forward*z
        this.position[0] += (right[0] * direction[0] + up[0] * direction[1] + forward[0] * direction[2]) * distance;
        this.position[1] += (right[1] * direction[0] + up[1] * direction[1] + forward[1] * direction[2]) * distance;
        this.position[2] += (right[2] * direction[0] + up[2] * direction[1] + forward[2] * direction[2]) * distance;
    }

    private rotateLocal(rotation: number[], angle: number): void {
        // rotation is [pitch, yaw, roll] in local space
        // Apply rotations to frame vectors

        const pitch = rotation[0] * angle;
        const yaw   = rotation[1] * angle;
        const roll  = rotation[2] * angle;

        // Rotate around local axes
        if (pitch !== 0) this.rotatePitch(pitch);
        if (yaw !== 0)   this.rotateYaw(yaw);
        if (roll !== 0)  this.rotateRoll(roll);
    }

    private rotatePitch(angle: number): void {
        // Rotate around right axis (frame[0,1,2])
        const axis = [this.frame[0], this.frame[1], this.frame[2]];
        this.rotateFrameVector(3, axis, angle); // up
        this.rotateFrameVector(6, axis, angle); // forward
    }

    private rotateYaw(angle: number): void {
        // Rotate around up axis (frame[3,4,5])
        const axis = [this.frame[3], this.frame[4], this.frame[5]];
        this.rotateFrameVector(0, axis, angle); // right
        this.rotateFrameVector(6, axis, angle); // forward
    }

    private rotateRoll(angle: number): void {
        // Rotate around forward axis (frame[6,7,8])
        const axis = [this.frame[6], this.frame[7], this.frame[8]];
        this.rotateFrameVector(0, axis, angle); // right
        this.rotateFrameVector(3, axis, angle); // up
    }

    private rotateFrameVector(startIdx: number, axis: number[], angle: number): void {
        // Get vector from frame
        const v = [this.frame[startIdx], this.frame[startIdx + 1], this.frame[startIdx + 2]];

        // Rodrigues' rotation formula
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const t = 1 - c;

        const dot = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
        const cross = [
            axis[1] * v[2] - axis[2] * v[1],
            axis[2] * v[0] - axis[0] * v[2],
            axis[0] * v[1] - axis[1] * v[0]
        ];

        // Write back to frame
        this.frame[startIdx]     = v[0] * c + cross[0] * s + axis[0] * dot * t;
        this.frame[startIdx + 1] = v[1] * c + cross[1] * s + axis[1] * dot * t;
        this.frame[startIdx + 2] = v[2] * c + cross[2] * s + axis[2] * dot * t;
    }

    private stabilizeFrame(): void {
        // Re-orthonormalize frame and align up with world up
        const forward = [this.frame[6], this.frame[7], this.frame[8]];
        const worldUp = [0, 1, 0];

        // Right = forward × worldUp
        const right = this.normalize(this.cross(forward, worldUp));

        // Up = right × forward
        const up = this.cross(right, forward);

        // Update frame
        this.frame[0] = right[0]; this.frame[1] = right[1]; this.frame[2] = right[2];
        this.frame[3] = up[0];    this.frame[4] = up[1];    this.frame[5] = up[2];
        this.frame[6] = forward[0]; this.frame[7] = forward[1]; this.frame[8] = forward[2];
    }

    private orthonormalizeFrame(): void {
        // Gram-Schmidt orthonormalization
        // Keep forward, recalculate right and up

        // Normalize forward
        let forward = [this.frame[6], this.frame[7], this.frame[8]];
        forward = this.normalize(forward);

        // Get up (might not be perpendicular)
        let up = [this.frame[3], this.frame[4], this.frame[5]];

        // Right = forward × up
        let right = this.cross(forward, up);
        right = this.normalize(right);

        // Recalculate up = right × forward
        up = this.cross(right, forward);

        // Update frame
        this.frame[0] = right[0];   this.frame[1] = right[1];   this.frame[2] = right[2];
        this.frame[3] = up[0];      this.frame[4] = up[1];      this.frame[5] = up[2];
        this.frame[6] = forward[0]; this.frame[7] = forward[1]; this.frame[8] = forward[2];
    }

    // ============================================================================
    // Private: Vector Math
    // ============================================================================

    private normalize(v: number[]): number[] {
        const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        if (len === 0) return [0, 0, 1];
        return [v[0] / len, v[1] / len, v[2] / len];
    }

    private cross(a: number[], b: number[]): number[] {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    }

    // ============================================================================
    // Private: Parameter Updates
    // ============================================================================

     private updateParameters(): void {
        // Create new arrays so ParameterStore detects changes
        this.app.parameterStore.set('camera.position', [...this.position]);
        this.app.parameterStore.set('camera.frame', new Float32Array(this.frame));

        this.bus.emit('camera.moved', {
            position: this.position,
            frame: this.frame
        });
    }



    // ============================================================================
    // Private: Keyboard Events
    // ============================================================================

    private onKeyDown = (e: KeyboardEvent): void => {
        this.pressed.add(e.code);
    };

    private onKeyUp = (e: KeyboardEvent): void => {
        this.pressed.delete(e.code);
    };
}

export { KeyboardControls };
