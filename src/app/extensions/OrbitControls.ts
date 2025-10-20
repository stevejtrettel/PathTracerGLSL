// app/extensions/OrbitCameraExtension.ts
import type { Extension } from '../types';

/**
 * OrbitCameraExtension provides mouse-based camera controls
 * Left drag to orbit around target point
 */
class OrbitControls implements Extension {
    name = 'orbit-camera';
    version = '1.0.0';
    description = 'Mouse drag to orbit camera around target';

    private app: any;
    private bus: any;
    private canvas: HTMLCanvasElement | null = null;

    // Camera state (spherical coordinates)
    private distance = 5;           // Distance from target
    private azimuth = 0;            // Horizontal angle (radians)
    private elevation = 0;          // Vertical angle (radians)
    private target = [0, 0, 0];     // What we're looking at (fixed for now)

    // Mouse tracking
    private isDragging = false;
    private lastMouseX = 0;
    private lastMouseY = 0;

    // Settings
    private orbitSpeed = 0.01;      // Sensitivity of orbit
    private minElevation = -1.5;    // Prevent camera flipping
    private maxElevation = 1.5;

    install(app: any, bus: any): void {
        this.app = app;
        this.bus = bus;

        // Find canvas
        this.canvas = document.querySelector('canvas');
        if (!this.canvas) {
            throw new Error('OrbitCamera: No canvas found');
        }

        // Register as service
        app.registerService('camera', this);

        // Read initial camera state from parameters
        const pos = app.parameterStore.get('camera.position');
        if (pos) {
            this.cartesianToSpherical(pos);
        }

        // Setup mouse listeners
        this.canvas.addEventListener('mousedown', this.onMouseDown);
        this.canvas.addEventListener('mousemove', this.onMouseMove);
        this.canvas.addEventListener('mouseup', this.onMouseUp);
        this.canvas.addEventListener('mouseleave', this.onMouseUp); // Stop dragging if mouse leaves

        console.log('OrbitCamera extension installed');
    }

    uninstall(): void {
        if (this.canvas) {
            this.canvas.removeEventListener('mousedown', this.onMouseDown);
            this.canvas.removeEventListener('mousemove', this.onMouseMove);
            this.canvas.removeEventListener('mouseup', this.onMouseUp);
            this.canvas.removeEventListener('mouseleave', this.onMouseUp);
        }
    }

    // ============================================================================
    // Public API (for other extensions or programmatic control)
    // ============================================================================

    /**
     * Get current camera position
     */
    getPosition(): [number, number, number] {
        return this.sphericalToCartesian();
    }

    /**
     * Get current target
     */
    getTarget(): [number, number, number] {
        return [this.target[0], this.target[1], this.target[2]];
    }

    /**
     * Set orbit distance
     */
    setDistance(distance: number): void {
        this.distance = Math.max(0.1, distance);
        this.updateCamera();
    }

    // ============================================================================
    // Private: Mouse Event Handlers
    // ============================================================================

    private onMouseDown = (e: MouseEvent): void => {
        // Only left button
        if (e.button !== 0) return;

        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
    };

    private onMouseMove = (e: MouseEvent): void => {
        if (!this.isDragging) return;

        const deltaX = e.clientX - this.lastMouseX;
        const deltaY = e.clientY - this.lastMouseY;

        // Update angles
        this.azimuth -= deltaX * this.orbitSpeed;
        this.elevation += deltaY * this.orbitSpeed;  // CHANGED: - to +

        // Clamp elevation to prevent camera flipping upside down
        this.elevation = Math.max(this.minElevation, Math.min(this.maxElevation, this.elevation));

        // Update camera position
        this.updateCamera();

        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
    };

    private onMouseUp = (): void => {
        this.isDragging = false;
    };

    // ============================================================================
    // Private: Camera Math
    // ============================================================================

    private updateCamera(): void {
        // Convert spherical coordinates to cartesian position
        const newPos = this.sphericalToCartesian();

        // Update parameter store (this triggers uniform update via App's onChange)
        this.app.parameterStore.set('camera.position', newPos);

        // Emit event for other extensions
        this.bus.emit('camera.moved', {
            position: newPos,
            target: this.target
        });
    }

    private sphericalToCartesian(): [number, number, number] {
        // Convert spherical (azimuth, elevation, distance) to cartesian (x, y, z)
        // azimuth: rotation around Y axis
        // elevation: angle above/below horizontal plane

        const x = this.target[0] + this.distance * Math.cos(this.elevation) * Math.sin(this.azimuth);
        const y = this.target[1] + this.distance * Math.sin(this.elevation);
        const z = this.target[2] + this.distance * Math.cos(this.elevation) * Math.cos(this.azimuth);

        return [x, y, z];
    }

    private cartesianToSpherical(pos: number[]): void {
        // Calculate spherical coordinates from cartesian position
        // Used during initialization to sync with existing camera position

        const dx = pos[0] - this.target[0];
        const dy = pos[1] - this.target[1];
        const dz = pos[2] - this.target[2];

        this.distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        this.azimuth = Math.atan2(dx, dz);
        this.elevation = Math.asin(dy / this.distance);
    }
}

export { OrbitControls };
