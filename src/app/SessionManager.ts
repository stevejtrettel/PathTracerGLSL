// app/SessionManager.ts
import type {SessionData} from "./types";
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

        // Capture tile job first to check if we're tiling
        const tileJob = this.app.tiledRenderer.getCurrentJob();

        // Capture parameters, but exclude resolution if tiling
        const parameters = this.app.parameterStore.serialize();
        if (tileJob) {
            delete parameters['resolution'];
        }

        const session: SessionData = {
            // Metadata
            version: SESSION_VERSION,
            timestamp: Date.now(),

            // Core state
            activeRecipe: this.app.engine.getActiveRecipeId() || '',
            parameters: parameters,

            // Render state
            renderMode: this.app.renderCoordinator.getMode(),
            sampleCount: this.app.engine.sampleCount,

            // Camera
            camera: this.captureCamera(),

            // Extensions
            extensions: this.captureExtensionStates(),

            // Tiling
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

        // Validate version
        if (session.version !== SESSION_VERSION) {
            console.warn(`Session version mismatch: ${session.version} vs ${SESSION_VERSION}`);
            // For now, proceed anyway (can add migration later)
        }

        // Stop rendering during restoration
        const wasRunning = this.app.renderCoordinator.isRunning();
        if (wasRunning) {
            this.app.renderCoordinator.stop();
        }

        // 1. Switch to saved recipe
        if (session.activeRecipe) {
            this.app.switchRecipe(session.activeRecipe);
        }

        // 2. Restore parameters (silent, no onChange cascade)
        this.app.parameterStore.restore(session.parameters);

        // 3. Restore render mode
        this.app.renderCoordinator.setMode(session.renderMode);

        // 4. Reset accumulation (sample count will be different)
        this.app.renderCoordinator.resetAccumulation('session_load');

        // 5. Restore camera
        this.restoreCamera(session.camera);

        // 6. Restore extension states
        this.restoreExtensionStates(session.extensions);

        // 7. Resume rendering if it was running
        if (wasRunning) {
            this.app.renderCoordinator.start();
        }

        // 8. Restore tile job if present
        if (session.tileJob) {
            this.app.tiledRenderer.resumeJob(session.tileJob);
        }

        console.log('✓ Session restored');
        this.app.bus.emit('session.loaded', { timestamp: session.timestamp });
    }

    /**app.tiledRenderer.stopJob();
     * Save session to file (downloads JSON)
     */
    async save(filename?: string): Promise<string> {
        const session = this.captureState();

        // Generate filename if not provided
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        const dateStr = `${month}${day}`;
        const timeStr = `${hours}${minutes}`;

        const defaultFilename = `session_${year}_${dateStr}_${timeStr}.json`;
        const finalFilename = filename || defaultFilename;

        // Add filename to metadata
        session.metadata = {
            title: finalFilename,
            description: `Session saved at ${now.toLocaleString()}`
        };

        // Convert to JSON
        const json = JSON.stringify(session, null, 2);

        // Trigger download
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = finalFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

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

        this.validateSession(session);
        this.restoreState(session);
    }

    /**
     * Quick save with auto-generated filename
     */
    async quickSave(): Promise<string> {
        return this.save();
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    private captureCamera(): SessionData['camera'] {
        // Try to get from camera extension first
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

    private restoreCamera(camera: SessionData['camera']): void {
        // Try to restore via camera extension
        const cameraService = this.app.getService('camera');
        if (cameraService && typeof cameraService.getPosition === 'function') {
            // Extension will update parameters
            // (For now, just let parameter restore handle it)
        }

        // Parameters already restored in restoreState()
        // Camera extension will pick them up on next frame
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

        // Check if recipe exists
        const recipes = this.app.engine.getAvailableRecipes();
        if (!recipes.includes(session.activeRecipe)) {
            throw new Error(`Unknown recipe in session: ${session.activeRecipe}`);
        }
    }

    // Access to app's extensions
    private get extensions(): Map<string, any> {
        return this.app['extensions'];
    }
}
