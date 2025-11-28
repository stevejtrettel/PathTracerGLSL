// app/extensions/OrbitControls.ts
// Mouse-based orbit camera controls for App

import type { Extension } from '../types.js';
import type { App } from '../App.js';
import type { EventBus } from '../EventBus.js';
import { EventManager } from '../utils/EventManager.js';

/**
 * OrbitControls - Mouse-based orbit camera controls
 *
 * Controls:
 * - Left drag: Orbit around target
 * - Mouse wheel: Zoom in/out
 *
 * Camera maintains a fixed target point and moves on a sphere around it.
 *
 * Updates parameters:
 * - camera.position: Current camera position [x, y, z]
 * - camera.target: Look-at target [x, y, z]
 */
export class OrbitControls implements Extension {
    name = 'orbit-camera';
    version = '1.0.0';
    description = 'Mouse orbit camera controls';

    private app: App | null = null;
    private bus: EventBus | null = null;
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

    // Touch state
    private touchState = {
        touching: false,
        lastX: 0,
        lastY: 0,
        distance: 0 // For pinch zoom
    };

    install(app: App, bus: EventBus): void {
        this.app = app;
        this.bus = bus;

        this.canvas = app.getCanvas();
        if (!this.canvas) {
            throw new Error('OrbitControls: No canvas found');
        }

        this.initializeFromParameters();

        // Mouse events
        this.events.add(this.canvas, 'mousedown', this.onMouseDown);
        this.events.add(this.canvas, 'mousemove', this.onMouseMove);
        this.events.add(this.canvas, 'mouseup', this.onMouseUp);
        this.events.add(this.canvas, 'mouseleave', this.onMouseUp);
        this.events.add(this.canvas, 'wheel', this.onWheel);

        // Touch events
        this.events.add(this.canvas, 'touchstart', this.onTouchStart);
        this.events.add(this.canvas, 'touchmove', this.onTouchMove);
        this.events.add(this.canvas, 'touchend', this.onTouchEnd);

        // Prevent default touch actions
        this.canvas.style.touchAction = 'none';

        console.log('OrbitControls extension installed (Mouse + Touch)');
    }

    uninstall(): void {
        this.events.removeAll();
        this.app = null;
        this.bus = null;
        this.canvas = null;
    }

    // ============================================================================
    // Public API
    // ============================================================================

    /**
     * Get current camera position
     */
    getPosition(): [number, number, number] {
        return this.sphericalToCartesian();
    }

    /**
     * Get current camera target
     */
    getTarget(): [number, number, number] {
        return [...this.target];
    }

    /**
     * Set camera distance from target
     */
    setDistance(distance: number): void {
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, distance));
        this.updateCamera();
    }

    /**
     * Set camera target (look-at point)
     */
    setTarget(target: [number, number, number]): void {
        this.target = [...target];
        this.updateCamera();
    }

    /**
     * Set azimuth angle (horizontal rotation)
     */
    setAzimuth(azimuth: number): void {
        this.azimuth = azimuth;
        this.updateCamera();
    }

    /**
     * Set elevation angle (vertical rotation)
     */
    setElevation(elevation: number): void {
        this.elevation = Math.max(this.minElevation, Math.min(this.maxElevation, elevation));
        this.updateCamera();
    }

    /**
     * Configure orbit speed
     */
    setOrbitSpeed(speed: number): void {
        this.orbitSpeed = speed;
    }

    /**
     * Configure zoom speed
     */
    setZoomSpeed(speed: number): void {
        this.zoomSpeed = speed;
    }

    /**
     * Save state for session persistence
     */
    saveState(): any {
        return {
            distance: this.distance,
            azimuth: this.azimuth,
            elevation: this.elevation,
            target: this.target
        };
    }

    /**
     * Restore state from session
     */
    restoreState(state: any): void {
        if (state.distance !== undefined) this.distance = state.distance;
        if (state.azimuth !== undefined) this.azimuth = state.azimuth;
        if (state.elevation !== undefined) this.elevation = state.elevation;
        if (state.target !== undefined) this.target = [state.target[0], state.target[1], state.target[2]];
        this.updateCamera();
    }

    // ============================================================================
    // Private: Initialization
    // ============================================================================

    private initializeFromParameters(): void {
        if (!this.app) return;

        // Read target
        const target = this.app.getParameter('camera.target');
        if (target) {
            this.target = [target[0], target[1], target[2]];
        }

        // Read position and convert to spherical
        const pos = this.app.getParameter('camera.position');
        if (pos) {
            this.cartesianToSpherical(pos);
        }

        // Set initial target parameter if not set
        if (!target) {
            this.app.setParameter('camera.target', this.target);
        }
    }

    // ============================================================================
    // Private: Mouse Event Handlers
    // ============================================================================

    private onMouseDown = (e: MouseEvent): void => {
        if (e.button !== 0) return;  // Only left button

        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
    };

    private onMouseMove = (e: MouseEvent): void => {
        if (!this.isDragging) return;

        const deltaX = e.clientX - this.lastMouseX;
        const deltaY = e.clientY - this.lastMouseY;

        this.handleOrbit(deltaX, deltaY);

        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
    };

    private onMouseUp = (): void => {
        this.isDragging = false;
    };

    private onWheel = (e: WheelEvent): void => {
        e.preventDefault();

        // Zoom in/out based on scroll direction
        const delta = e.deltaY > 0 ? 1 : -1;
        this.handleZoom(delta);
    };

    // ============================================================================
    // Private: Touch Event Handlers
    // ============================================================================

    private onTouchStart = (e: TouchEvent): void => {
        e.preventDefault();

        if (e.touches.length === 1) {
            // Single finger - start orbiting
            this.touchState.touching = true;
            this.touchState.lastX = e.touches[0].clientX;
            this.touchState.lastY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            // Two fingers - start zooming
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            this.touchState.distance = Math.sqrt(dx * dx + dy * dy);
        }
    };

    private onTouchMove = (e: TouchEvent): void => {
        e.preventDefault();

        if (e.touches.length === 1 && this.touchState.touching) {
            // Single finger: orbit camera
            const x = e.touches[0].clientX;
            const y = e.touches[0].clientY;

            const deltaX = x - this.touchState.lastX;
            const deltaY = y - this.touchState.lastY;

            this.handleOrbit(deltaX, deltaY);

            this.touchState.lastX = x;
            this.touchState.lastY = y;

        } else if (e.touches.length === 2) {
            // Two fingers: zoom camera
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Calculate delta for zoom (inverted relative to wheel)
            // If distance increases, we zoom in (decrease distance)
            const delta = this.touchState.distance - distance;

            // Scale delta to be reasonable
            this.handleZoom(delta * 0.05);

            this.touchState.distance = distance;
        }
    };

    private onTouchEnd = (e: TouchEvent): void => {
        e.preventDefault();
        if (e.touches.length === 0) {
            this.touchState.touching = false;
        }
    };

    // ============================================================================
    // Private: Camera Logic
    // ============================================================================

    private handleOrbit(deltaX: number, deltaY: number): void {
        this.azimuth -= deltaX * this.orbitSpeed;
        this.elevation += deltaY * this.orbitSpeed;

        // Clamp elevation to prevent flipping
        this.elevation = Math.max(this.minElevation, Math.min(this.maxElevation, this.elevation));

        this.updateCamera();
    }

    private handleZoom(delta: number): void {
        this.distance *= (1 + delta * this.zoomSpeed);
        // Clamp distance
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
        this.updateCamera();
    }

    private updateCamera(): void {
        if (!this.app || !this.bus) return;

        const newPos = this.sphericalToCartesian();

        // Update parameters (triggers accumulation reset via ParameterStore)
        this.app.setParameter('camera.position', newPos);
        this.app.setParameter('camera.target', this.target);

        // Emit camera event for other extensions
        this.bus.emit('camera.moved', {
            position: newPos,
            target: this.target
        });
    }

    private sphericalToCartesian(): [number, number, number] {
        // Convert spherical coordinates (distance, azimuth, elevation) to Cartesian
        // azimuth: rotation around Y axis
        // elevation: angle from horizontal plane
        const x = this.target[0] + this.distance * Math.cos(this.elevation) * Math.sin(this.azimuth);
        const y = this.target[1] + this.distance * Math.sin(this.elevation);
        const z = this.target[2] + this.distance * Math.cos(this.elevation) * Math.cos(this.azimuth);

        return [x, y, z];
    }

    private cartesianToSpherical(pos: number[]): void {
        // Convert Cartesian position to spherical coordinates relative to target
        const dx = pos[0] - this.target[0];
        const dy = pos[1] - this.target[1];
        const dz = pos[2] - this.target[2];

        this.distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        this.azimuth = Math.atan2(dx, dz);
        this.elevation = Math.asin(dy / this.distance);
    }
}
