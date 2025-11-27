/**
 * DisplayManager - Manages display modes
 *
 * Handles registration and switching between display modes.
 * Provides the context needed for modes to operate.
 */
import type { DisplayMode, DisplayModeContext, DisplayFrameInfo } from './DisplayMode.js';
import { FullscreenDisplay } from './FullscreenDisplay.js';

export class DisplayManager {
    private modes: Map<string, DisplayMode> = new Map();
    private _activeMode: DisplayMode | null = null;
    private context: DisplayModeContext | null = null;

    constructor() {
        // Register default mode
        this.register(new FullscreenDisplay());
    }

    /**
     * Initialize the manager with context
     */
    initialize(context: DisplayModeContext): void {
        this.context = context;

        // Activate default mode if none active
        if (!this._activeMode && this.modes.has('fullscreen')) {
            this.setMode('fullscreen');
        }
    }

    /**
     * Register a display mode
     */
    register(mode: DisplayMode): void {
        if (this.modes.has(mode.id)) {
            console.warn(`DisplayMode '${mode.id}' already registered, replacing`);
            this.modes.get(mode.id)?.dispose();
        }
        this.modes.set(mode.id, mode);
    }

    /**
     * Unregister a display mode
     */
    unregister(id: string): void {
        const mode = this.modes.get(id);
        if (mode) {
            if (this._activeMode === mode) {
                this.setMode('fullscreen'); // Fall back to default
            }
            mode.dispose();
            this.modes.delete(id);
        }
    }

    /**
     * Get current active mode
     */
    get activeMode(): DisplayMode | null {
        return this._activeMode;
    }

    /**
     * Get active mode ID
     */
    get activeModeId(): string | null {
        return this._activeMode?.id ?? null;
    }

    /**
     * Get all registered mode IDs
     */
    get modeIds(): string[] {
        return Array.from(this.modes.keys());
    }

    /**
     * Switch to a different display mode
     */
    setMode(id: string): void {
        const mode = this.modes.get(id);
        if (!mode) {
            throw new Error(`Unknown display mode: ${id}`);
        }

        if (!this.context) {
            throw new Error('DisplayManager not initialized');
        }

        // Deactivate current mode
        if (this._activeMode) {
            this._activeMode.deactivate();
        }

        // Activate new mode
        this._activeMode = mode;
        mode.activate(this.context);
    }

    /**
     * Handle resize events
     */
    onResize(width: number, height: number): void {
        this._activeMode?.onResize?.(width, height);
    }

    /**
     * Called each frame to update display mode
     */
    onFrame(frameInfo: DisplayFrameInfo): void {
        this._activeMode?.onFrame?.(frameInfo);
    }

    /**
     * Check if a mode is registered
     */
    hasMode(id: string): boolean {
        return this.modes.has(id);
    }

    /**
     * Get a mode by ID
     */
    getMode(id: string): DisplayMode | undefined {
        return this.modes.get(id);
    }

    /**
     * Dispose all modes and clean up
     */
    dispose(): void {
        if (this._activeMode) {
            this._activeMode.deactivate();
            this._activeMode = null;
        }

        for (const mode of this.modes.values()) {
            mode.dispose();
        }
        this.modes.clear();
        this.context = null;
    }
}
