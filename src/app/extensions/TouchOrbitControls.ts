// app/extensions/TouchOrbitControls.ts
// Adapted from app/extensions/TouchOrbitControls.ts for FlexibleApp

import type { Extension } from '../types.js';
import type { FlexibleApp } from '../FlexibleApp.js';
import type { EventBus } from '../EventBus.js';
import { EventManager } from '../utils/EventManager.js';

/**
 * Touch orbit state
 */
interface TouchOrbitState {
    touching: boolean;
    lastX: number;
    lastY: number;
    distance: number;  // For pinch zoom tracking
    azimuth: number;   // Current horizontal rotation
    elevation: number; // Current vertical rotation
    radius: number;    // Distance from origin
}

/**
 * TouchOrbitControls - Touch-based orbit camera controls
 *
 * Controls:
 * - One finger drag: Orbit camera around target
 * - Two finger pinch: Zoom in/out
 *
 * Updates parameters:
 * - camera.position: Computed from azimuth/elevation/radius
 *
 * Designed for mobile/tablet touch interfaces.
 */
export class TouchOrbitControls implements Extension {
    name = 'touch-orbit-controls';
    version = '1.0.0';
    description = 'Touch orbit controls for mobile';

    private app: FlexibleApp | null = null;
    private bus: EventBus | null = null;
    private events = new EventManager();
    private state: TouchOrbitState = {
        touching: false,
        lastX: 0,
        lastY: 0,
        distance: 0,
        azimuth: 0,
        elevation: Math.PI / 4,  // 45 degrees default
        radius: 5
    };

    // Tuning parameters
    private readonly ORBIT_SPEED = 0.005;
    private readonly ZOOM_SPEED = 0.01;
    private readonly MIN_RADIUS = 1;
    private readonly MAX_RADIUS = 50;
    private readonly MIN_ELEVATION = 0.1;
    private readonly MAX_ELEVATION = Math.PI - 0.1;

    install(app: FlexibleApp, bus: EventBus): void {
        this.app = app;
        this.bus = bus;

        const canvas = app.getCanvas();

        // Listen for touch events
        this.events.add(canvas, 'touchstart', this.handleTouchStart);
        this.events.add(canvas, 'touchmove', this.handleTouchMove);
        this.events.add(canvas, 'touchend', this.handleTouchEnd);

        // Prevent default touch behaviors (zoom, scroll)
        canvas.style.touchAction = 'none';

        // Initialize from existing camera position if set
        this.initializeFromParameters();

        console.log('TouchOrbitControls installed');
    }

    uninstall(): void {
        this.events.removeAll();
        this.app = null;
        this.bus = null;
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
     * Set camera radius (distance from origin)
     */
    setRadius(radius: number): void {
        this.state.radius = Math.max(this.MIN_RADIUS, Math.min(this.MAX_RADIUS, radius));
        this.updateCameraPosition();
    }

    /**
     * Set azimuth angle (horizontal rotation)
     */
    setAzimuth(azimuth: number): void {
        this.state.azimuth = azimuth;
        this.updateCameraPosition();
    }

    /**
     * Set elevation angle (vertical rotation)
     */
    setElevation(elevation: number): void {
        this.state.elevation = Math.max(this.MIN_ELEVATION, Math.min(this.MAX_ELEVATION, elevation));
        this.updateCameraPosition();
    }

    /**
     * Save state for session persistence
     */
    saveState(): any {
        return {
            azimuth: this.state.azimuth,
            elevation: this.state.elevation,
            radius: this.state.radius
        };
    }

    /**
     * Restore state from session
     */
    restoreState(state: any): void {
        if (state.azimuth !== undefined) this.state.azimuth = state.azimuth;
        if (state.elevation !== undefined) this.state.elevation = state.elevation;
        if (state.radius !== undefined) this.state.radius = state.radius;
        this.updateCameraPosition();
    }

    // ============================================================================
    // Private: Initialization
    // ============================================================================

    private initializeFromParameters(): void {
        if (!this.app) return;

        const pos = this.app.getParameter('camera.position');
        if (pos) {
            this.initializeFromPosition(pos);
        }
    }

    private initializeFromPosition(position: number[]): void {
        // Convert initial Cartesian position to spherical coordinates
        const [x, y, z] = position;
        this.state.radius = Math.sqrt(x * x + y * y + z * z);
        if (this.state.radius > 0) {
            this.state.elevation = Math.acos(y / this.state.radius);
            this.state.azimuth = Math.atan2(z, x);
        }
    }

    // ============================================================================
    // Private: Touch Event Handlers
    // ============================================================================

    private handleTouchStart = (e: TouchEvent): void => {
        e.preventDefault();

        if (e.touches.length === 1) {
            // Single finger - start orbiting
            this.state.touching = true;
            this.state.lastX = e.touches[0].clientX;
            this.state.lastY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            // Two fingers - start zooming
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            this.state.distance = Math.sqrt(dx * dx + dy * dy);
        }
    };

    private handleTouchMove = (e: TouchEvent): void => {
        e.preventDefault();

        if (e.touches.length === 1 && this.state.touching) {
            // Single finger: orbit camera
            const x = e.touches[0].clientX;
            const y = e.touches[0].clientY;

            const deltaX = x - this.state.lastX;
            const deltaY = y - this.state.lastY;

            // Natural rotation (swipe right = rotate right)
            this.state.azimuth += deltaX * this.ORBIT_SPEED;
            this.state.elevation = Math.max(
                this.MIN_ELEVATION,
                Math.min(this.MAX_ELEVATION, this.state.elevation - deltaY * this.ORBIT_SPEED)
            );

            this.state.lastX = x;
            this.state.lastY = y;

            this.updateCameraPosition();

        } else if (e.touches.length === 2) {
            // Two fingers: zoom camera
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            const delta = distance - this.state.distance;
            this.state.radius = Math.max(
                this.MIN_RADIUS,
                Math.min(this.MAX_RADIUS, this.state.radius - delta * this.ZOOM_SPEED)
            );

            this.state.distance = distance;

            this.updateCameraPosition();
        }
    };

    private handleTouchEnd = (e: TouchEvent): void => {
        e.preventDefault();

        if (e.touches.length === 0) {
            this.state.touching = false;
        }
    };

    // ============================================================================
    // Private: Camera Math
    // ============================================================================

    private sphericalToCartesian(): [number, number, number] {
        // Convert spherical (azimuth, elevation, radius) to Cartesian
        // Using physics convention: elevation from Y-axis
        const x = this.state.radius * Math.sin(this.state.elevation) * Math.cos(this.state.azimuth);
        const y = this.state.radius * Math.cos(this.state.elevation);
        const z = this.state.radius * Math.sin(this.state.elevation) * Math.sin(this.state.azimuth);

        return [x, y, z];
    }

    private updateCameraPosition(): void {
        if (!this.app || !this.bus) return;

        const position = this.sphericalToCartesian();

        // Update parameter (triggers accumulation reset via ParameterStore)
        this.app.setParameter('camera.position', position);

        // Emit camera event for other extensions
        this.bus.emit('camera.moved', {
            position,
            target: [0, 0, 0]  // TouchOrbitControls always orbits origin
        });
    }
}
