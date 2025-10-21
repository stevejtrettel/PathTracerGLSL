// app/SessionManager.ts
import type { SessionData } from "./types";
import type { App } from './App';

const SESSION_VERSION = '1.0.0';

/**
 * SessionManager - Save and restore complete application state
 */
export class SessionManager {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Capture complete application state
     */
    captureState(): SessionData {
        console.log('Capturing session state...');

        const tileJob = this.app.tiledRenderer.getCurrentJob();

        // Capture parameters, exclude resolution during tiling
        const parameters = this.app.parameterStore.serialize();
        if (tileJob) {
            delete parameters['resolution'];
        }

        const session: SessionData = {
            version: SESSION_VERSION,
            timestamp: Date.now(),
            activeRecipe: this.app.engine.getActiveRecipeId() || '',
            parameters,
            renderMode: this.app.renderCoordinator.getMode(),
            sampleCount: this.app.engine.sampleCount,
            camera: this.captureCamera(),
            extensions: this.captureExtensionStates(),
            tileJob: tileJob || undefined
        };

        console.log('✓ State captured');
        return session;
    }

    /**
     * Restore application state from session
     */
    restoreState(session: SessionData): void {
        console.log('Restoring session state...');

        this.validateSession(session);

        if (session.version !== SESSION_VERSION) {
            console.warn(`Session version mismatch: ${session.version} vs ${SESSION_VERSION}`);
        }

        // Stop rendering during restoration
        const wasRunning = this.app.renderCoordinator.isRunning();
        if (wasRunning) {
            this.app.renderCoordinator.stop();
        }

        // Restore state in order
        if (session.activeRecipe) {
            this.app.switchRecipe(session.activeRecipe);
        }

        this.app.parameterStore.restore(session.parameters);
        this.app.renderCoordinator.resetAccumulation('session_load');
        this.restoreCamera(session.camera);
        this.restoreExtensionStates(session.extensions);

        // Resume tile job or normal rendering
        if (session.tileJob) {
            this.app.tiledRenderer.resumeJob(session.tileJob);
        } else if (wasRunning) {
            this.app.renderCoordinator.startInteractive();
        }

        console.log('✓ Session restored');
        this.app.bus.emit('session.loaded', { timestamp: session.timestamp });
    }

    /**
     * Save session to file
     */
    async save(filename?: string): Promise<string> {
        const session = this.captureState();
        const finalFilename = filename || this.generateFilename();

        // Add metadata
        session.metadata = {
            title: finalFilename,
            description: `Session saved at ${new Date().toLocaleString()}`
        };

        const json = JSON.stringify(session, null, 2);
        this.downloadFile(json, finalFilename);

        console.log(`✓ Session saved: ${finalFilename}`);
        this.app.bus.emit('session.saved', { filename: finalFilename });

        return finalFilename;
    }

    /**
     * Load session from file
     */
    async loadFromFile(file: File): Promise<void> {
        console.log(`Loading session from ${file.name}...`);

        const text = await file.text();
        const session = JSON.parse(text) as SessionData;

        this.restoreState(session);
    }

    /**
     * Quick save with auto-generated filename
     */
    async quickSave(): Promise<string> {
        return this.save();
    }

    // ============================================================================
    // Private: State Capture
    // ============================================================================

    private captureCamera(): SessionData['camera'] {
        const cameraService = this.app.getService('camera');

        if (cameraService && typeof cameraService.getPosition === 'function') {
            return {
                position: cameraService.getPosition(),
                frame: cameraService.getFrame ? Array.from(cameraService.getFrame()) : undefined
            };
        }

        // Fallback to parameters
        return {
            position: this.app.parameterStore.get('camera.position') || [0, 0, 5],
            target: this.app.parameterStore.get('camera.target'),
            fov: this.app.parameterStore.get('camera.fov') || 60
        };
    }

    private captureExtensionStates(): Record<string, any> {
        const states: Record<string, any> = {};

        for (const [name, extension] of this.extensions.entries()) {
            if (typeof extension.saveState === 'function') {
                try {
                    const state = extension.saveState();
                    if (state !== undefined) {
                        states[name] = state;
                    }
                } catch (error) {
                    console.error(`Failed to save state for extension '${name}':`, error);
                }
            }
        }

        return states;
    }

    // ============================================================================
    // Private: State Restoration
    // ============================================================================

    private restoreCamera(camera: SessionData['camera']): void {
        // Parameters already restored - camera will pick them up
        // Camera service doesn't need explicit restoration
    }

    private restoreExtensionStates(states: Record<string, any>): void {
        for (const [name, state] of Object.entries(states)) {
            const extension = this.extensions.get(name);

            if (extension && typeof extension.restoreState === 'function') {
                try {
                    extension.restoreState(state);
                } catch (error) {
                    console.error(`Failed to restore state for extension '${name}':`, error);
                }
            }
        }
    }

    // ============================================================================
    // Private: Validation
    // ============================================================================

    private validateSession(session: any): void {
        if (!session.version) {
            throw new Error('Invalid session: missing version');
        }

        if (!session.activeRecipe) {
            throw new Error('Invalid session: missing activeRecipe');
        }

        if (!session.parameters) {
            throw new Error('Invalid session: missing parameters');
        }

        const recipes = this.app.engine.getAvailableRecipes();
        if (!recipes.includes(session.activeRecipe)) {
            throw new Error(`Unknown recipe in session: ${session.activeRecipe}`);
        }
    }

    // ============================================================================
    // Private: Utilities
    // ============================================================================

    private generateFilename(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        return `session_${year}_${month}${day}_${hours}${minutes}.json`;
    }

    private downloadFile(content: string, filename: string): void {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    private get extensions(): Map<string, any> {
        return this.app['extensions'];
    }
}
