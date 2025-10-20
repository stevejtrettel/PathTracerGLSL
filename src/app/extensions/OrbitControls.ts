// app/extensions/OrbitControls.ts
import type { Extension } from '../types';
import { EventManager } from '../utils/EventManager';

/**
 * OrbitControls - Mouse-based orbit camera controls
 *
 * Controls:
 * - Left drag: Orbit around target
 * - Mouse wheel: Zoom in/out
 *
 * Camera maintains a fixed target point and moves on a sphere around it.
 */
class OrbitControls implements Extension {
    name = 'orbit-camera';
    version = '1.0.0';
    description = 'Mouse orbit camera controls';

    private app: any;
    private bus: any;
    private canvas: HTMLCanvasElement | null = null;
    private events = new EventManager();

    // Camera state (spherical coordinates)
    private distance = 5;
    private azimuth = 0;
    private elevation = 0;
    private target: [number, number, number] = [0, 0, 0];

    // Mouse tracking
    private isDragging = false;
    private lastMouseX = 0;
    private lastMouseY = 0;

    // Settings
    private orbitSpeed = 0.01;
    private zoomSpeed = 0.1;
    private minElevation = -Math.PI / 2 + 0.1;
    private maxElevation = Math.PI / 2 - 0.1;
    private minDistance = 0.1;
    private maxDistance = 100;

    install(app: any, bus: any): void {
        this.app = app;
        this.bus = bus;

        this.canvas = document.querySelector('canvas');
        if (!this.canvas) {
            throw new Error('OrbitCamera: No canvas found');
        }

        app.registerService('camera', this);

        this.initializeFromParameters();

        // Mouse events
        this.events.add(this.canvas, 'mousedown', this.onMouseDown);
        this.events.add(this.canvas, 'mousemove', this.onMouseMove);
        this.events.add(this.canvas, 'mouseup', this.onMouseUp);
        this.events.add(this.canvas, 'mouseleave', this.onMouseUp);
        this.events.add(this.canvas, 'wheel', this.onWheel);

        console.log('OrbitCamera extension installed');
    }

    uninstall(): void {
        this.events.removeAll();
    }

    // ============================================================================
    // Public API
    // ============================================================================

    getPosition(): [number, number, number] {
        return this.sphericalToCartesian();
    }

    getTarget(): [number, number, number] {
        return [...this.target];
    }

    setDistance(distance: number): void {
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, distance));
        this.updateCamera();
    }

    setTarget(target: [number, number, number]): void {
        this.target = [...target];
        this.updateCamera();
    }

    // ============================================================================
    // Private: Initialization
    // ============================================================================

    private initializeFromParameters(): void {
        // Read target
        const target = this.app.parameterStore.get('camera.target');
        if (target) {
            this.target = [target[0], target[1], target[2]];
        }

        // Read position and convert to spherical
        const pos = this.app.parameterStore.get('camera.position');
        if (pos) {
            this.cartesianToSpherical(pos);
        }

        // Update camera.target parameter if not set
        if (!target) {
            this.app.parameterStore.set('camera.target', this.target);
        }
    }

    // ============================================================================
    // Private: Event Handlers
    // ============================================================================

    private onMouseDown = (e: MouseEvent): void => {
        if (e.button !== 0) return;

        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
    };

    private onMouseMove = (e: MouseEvent): void => {
        if (!this.isDragging) return;

        const deltaX = e.clientX - this.lastMouseX;
        const deltaY = e.clientY - this.lastMouseY;

        this.azimuth -= deltaX * this.orbitSpeed;
        this.elevation += deltaY * this.orbitSpeed;

        // Clamp elevation
        this.elevation = Math.max(this.minElevation, Math.min(this.maxElevation, this.elevation));

        this.updateCamera();

        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
    };

    private onMouseUp = (): void => {
        this.isDragging = false;
    };

    private onWheel = (e: WheelEvent): void => {
        e.preventDefault();

        // Zoom in/out
        const delta = e.deltaY > 0 ? 1 : -1;
        this.distance *= (1 + delta * this.zoomSpeed);

        // Clamp distance
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));

        this.updateCamera();
    };

    // ============================================================================
    // Private: Camera Math
    // ============================================================================

    private updateCamera(): void {
        const newPos = this.sphericalToCartesian();

        this.app.parameterStore.set('camera.position', newPos);
        this.app.parameterStore.set('camera.target', this.target);

        this.bus.emit('camera.moved', {
            position: newPos,
            target: this.target
        });
    }

    private sphericalToCartesian(): [number, number, number] {
        const x = this.target[0] + this.distance * Math.cos(this.elevation) * Math.sin(this.azimuth);
        const y = this.target[1] + this.distance * Math.sin(this.elevation);
        const z = this.target[2] + this.distance * Math.cos(this.elevation) * Math.cos(this.azimuth);

        return [x, y, z];
    }

    private cartesianToSpherical(pos: number[]): void {
        const dx = pos[0] - this.target[0];
        const dy = pos[1] - this.target[1];
        const dz = pos[2] - this.target[2];

        this.distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        this.azimuth = Math.atan2(dx, dz);
        this.elevation = Math.asin(dy / this.distance);
    }
}

export { OrbitControls };
