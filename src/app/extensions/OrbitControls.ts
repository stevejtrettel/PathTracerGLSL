// app/extensions/OrbitControls.ts — Mouse/touch orbit camera controls
//
// Controls: Left drag = orbit, Wheel = zoom, Touch = orbit + pinch zoom
// Updates: camera.position, camera.target

import type { Extension } from '../types.js';
import type { App } from '../App.js';
import type { EventBus } from '../EventBus.js';
import { EventManager } from '../utils/EventManager.js';
import { AppEvents } from '../events.js';

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
        distance: 0
    };

    install(app: App, bus: EventBus): void {
        this.app = app;
        this.bus = bus;

        this.canvas = app.getCanvas();
        if (!this.canvas) throw new Error('OrbitControls: No canvas found');

        this.initializeFromParameters();

        this.events.add(this.canvas, 'mousedown', this.onMouseDown);
        this.events.add(this.canvas, 'mousemove', this.onMouseMove);
        this.events.add(this.canvas, 'mouseup', this.onMouseUp);
        this.events.add(this.canvas, 'mouseleave', this.onMouseUp);
        this.events.add(this.canvas, 'wheel', this.onWheel);
        this.events.add(this.canvas, 'touchstart', this.onTouchStart);
        this.events.add(this.canvas, 'touchmove', this.onTouchMove);
        this.events.add(this.canvas, 'touchend', this.onTouchEnd);
        this.canvas.style.touchAction = 'none';
    }

    uninstall(): void {
        this.events.removeAll();
        this.app = null;
        this.bus = null;
        this.canvas = null;
    }

    // -- Public API --

    getPosition(): [number, number, number] { return this.sphericalToCartesian(); }
    getTarget(): [number, number, number] { return [...this.target]; }
    setOrbitSpeed(speed: number): void { this.orbitSpeed = speed; }
    setZoomSpeed(speed: number): void { this.zoomSpeed = speed; }

    setDistance(distance: number): void {
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, distance));
        this.updateCamera();
    }

    setTarget(target: [number, number, number]): void {
        this.target = [...target];
        this.updateCamera();
    }

    setAzimuth(azimuth: number): void {
        this.azimuth = azimuth;
        this.updateCamera();
    }

    setElevation(elevation: number): void {
        this.elevation = Math.max(this.minElevation, Math.min(this.maxElevation, elevation));
        this.updateCamera();
    }

    saveState(): any {
        return {
            distance: this.distance,
            azimuth: this.azimuth,
            elevation: this.elevation,
            target: this.target
        };
    }

    restoreState(state: any): void {
        if (state.distance !== undefined) this.distance = state.distance;
        if (state.azimuth !== undefined) this.azimuth = state.azimuth;
        if (state.elevation !== undefined) this.elevation = state.elevation;
        if (state.target !== undefined) this.target = [state.target[0], state.target[1], state.target[2]];
        this.updateCamera();
    }

    // -- Initialization --

    private initializeFromParameters(): void {
        if (!this.app) return;

        const target = this.app.getParameter('camera.target');
        if (target) this.target = [target[0], target[1], target[2]];

        const pos = this.app.getParameter('camera.position');
        if (pos) this.cartesianToSpherical(pos);

        if (!target) this.app.setParameter('camera.target', this.target);
    }

    // -- Mouse Handlers --

    private onMouseDown = (e: MouseEvent): void => {
        if (e.button !== 0) return;
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
    };

    private onMouseMove = (e: MouseEvent): void => {
        if (!this.isDragging) return;
        this.handleOrbit(e.clientX - this.lastMouseX, e.clientY - this.lastMouseY);
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
    };

    private onMouseUp = (): void => { this.isDragging = false; };

    private onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        this.handleZoom(e.deltaY > 0 ? 1 : -1);
    };

    // -- Touch Handlers --

    private onTouchStart = (e: TouchEvent): void => {
        e.preventDefault();
        if (e.touches.length === 1) {
            this.touchState.touching = true;
            this.touchState.lastX = e.touches[0].clientX;
            this.touchState.lastY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            this.touchState.distance = Math.sqrt(dx * dx + dy * dy);
        }
    };

    private onTouchMove = (e: TouchEvent): void => {
        e.preventDefault();

        if (e.touches.length === 1 && this.touchState.touching) {
            const x = e.touches[0].clientX;
            const y = e.touches[0].clientY;
            this.handleOrbit(x - this.touchState.lastX, y - this.touchState.lastY);
            this.touchState.lastX = x;
            this.touchState.lastY = y;
        } else if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            this.handleZoom((this.touchState.distance - distance) * 0.05);
            this.touchState.distance = distance;
        }
    };

    private onTouchEnd = (e: TouchEvent): void => {
        e.preventDefault();
        if (e.touches.length === 0) this.touchState.touching = false;
    };

    // -- Camera Logic --

    private handleOrbit(deltaX: number, deltaY: number): void {
        this.azimuth -= deltaX * this.orbitSpeed;
        this.elevation += deltaY * this.orbitSpeed;
        this.elevation = Math.max(this.minElevation, Math.min(this.maxElevation, this.elevation));
        this.updateCamera();
    }

    private handleZoom(delta: number): void {
        this.distance *= (1 + delta * this.zoomSpeed);
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
        this.updateCamera();
    }

    private updateCamera(): void {
        if (!this.app || !this.bus) return;

        const newPos = this.sphericalToCartesian();
        this.app.setParameter('camera.position', newPos);
        this.app.setParameter('camera.target', this.target);
        this.bus.emit(AppEvents.CAMERA_MOVED, { position: newPos, target: this.target });
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
