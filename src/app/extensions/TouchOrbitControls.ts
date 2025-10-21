// app/extensions/TouchOrbitControls.ts
import type { Extension } from '../types';
import { EventManager } from '../utils/EventManager';

interface TouchOrbitState {
    touching: boolean;
    lastX: number;
    lastY: number;
    distance: number;  // For pinch zoom
    azimuth: number;   // Current rotation angles
    elevation: number;
    radius: number;
}

/**
 * TouchOrbitControls - Touch-based orbit camera controls
 *
 * - One finger drag: Orbit camera around target
 * - Two finger pinch: Zoom in/out
 *
 * Updates parameters:
 * - camera.position (computed from azimuth/elevation/radius)
 * - camera.target (optional, if you want to update it)
 */
class TouchOrbitControls implements Extension {
    name = 'touch-orbit-controls';
    version = '1.0.0';
    description = 'Touch orbit controls for mobile';

    private app: any;
    private events = new EventManager();
    private state: TouchOrbitState = {
        touching: false,
        lastX: 0,
        lastY: 0,
        distance: 0,
        azimuth: 0,
        elevation: Math.PI / 4,  // 45 degrees
        radius: 5
    };

    private readonly ORBIT_SPEED = 0.005;
    private readonly ZOOM_SPEED = 0.01;
    private readonly MIN_RADIUS = 1;
    private readonly MAX_RADIUS = 50;
    private readonly MIN_ELEVATION = 0.1;
    private readonly MAX_ELEVATION = Math.PI - 0.1;

    install(app: any, bus: any): void {
        this.app = app;

        // Start with default orbit state
        // User can adjust by dragging

        // Listen for touch events on canvas
        const canvas = app.engine['gl'].canvas as HTMLElement;
        this.events.add(canvas, 'touchstart', this.handleTouchStart);
        this.events.add(canvas, 'touchmove', this.handleTouchMove);
        this.events.add(canvas, 'touchend', this.handleTouchEnd);

        // Prevent default touch behaviors (zoom, scroll)
        canvas.style.touchAction = 'none';

        console.log('TouchOrbitControls installed');
    }

    uninstall(): void {
        this.events.removeAll();
    }

    // ============================================================================
    // Touch Event Handlers
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
            // Orbit camera
            const x = e.touches[0].clientX;
            const y = e.touches[0].clientY;

            const deltaX = x - this.state.lastX;
            const deltaY = y - this.state.lastY;

            // FIXED: Flipped both signs to make rotation natural
            this.state.azimuth += deltaX * this.ORBIT_SPEED;  // Changed from -=
            this.state.elevation = Math.max(
                this.MIN_ELEVATION,
                Math.min(this.MAX_ELEVATION, this.state.elevation - deltaY * this.ORBIT_SPEED)  // Changed from +
            );

            this.state.lastX = x;
            this.state.lastY = y;

            this.updateCameraPosition();

        } else if (e.touches.length === 2) {
            // Zoom camera
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
    // Camera Update
    // ============================================================================

    private updateCameraPosition(): void {
        // Convert spherical (azimuth, elevation, radius) to Cartesian
        const x = this.state.radius * Math.sin(this.state.elevation) * Math.cos(this.state.azimuth);
        const y = this.state.radius * Math.cos(this.state.elevation);
        const z = this.state.radius * Math.sin(this.state.elevation) * Math.sin(this.state.azimuth);

        // Update parameter store
        this.app.parameterStore.set('camera.position', [x, y, z]);
    }

    private initializeFromPosition(position: number[]): void {
        // Convert initial Cartesian position to spherical
        const [x, y, z] = position;
        this.state.radius = Math.sqrt(x * x + y * y + z * z);
        this.state.elevation = Math.acos(y / this.state.radius);
        this.state.azimuth = Math.atan2(z, x);
    }
}

export { TouchOrbitControls };
