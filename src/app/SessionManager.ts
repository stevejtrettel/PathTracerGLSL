// app/SessionManager.ts
// Manages session save/restore operations

import { SessionError } from '../errors/RenderErrors.js';
import type { ParameterStore } from './ParameterStore.js';
import type { EventBus } from './EventBus.js';
import type { Extension } from './types.js';
import type { TileJob } from './TiledRenderer.js';
import { AppEvents } from './events.js';

/**
 * Session data structure
 *
 * Captures enough state to re-queue work on restore:
 * - Parameters + renderer: restore the scene setup
 * - productionGoal: re-start a production render
 * - tileJob: resume a tiled render (skip completed tiles)
 *
 * Does NOT capture GPU state (accumulation buffers, sample counts).
 * Restoring always re-renders from scratch, but tiled jobs skip
 * tiles whose output was already saved to disk.
 */
export interface SessionData {
    version: string;
    timestamp: number;

    // Core (always present)
    parameters: Record<string, any>;
    rendererId: string | null;
    extensions: Record<string, any>;

    // Production job (if one was active)
    productionGoal?: { targetSamples: number };

    // Tiled job (if one was active)
    tileJob?: TileJob;
}

const SESSION_VERSION = '1.0.0';

/**
 * SessionManager handles session save/restore operations
 *
 * Responsibilities:
 * - Save current session state (parameters, renderer, extensions, jobs)
 * - Restore session state from saved data
 * - Quick save/load via file downloads
 * - Manage extension state persistence
 */
export class SessionManager {
    constructor(
        private parameterStore: ParameterStore,
        private eventBus: EventBus,
        private extensions: Map<string, Extension>,
        private getActiveRendererId: () => string | null,
        private setActiveRendererId: (id: string) => void,
        private getProductionGoal?: () => { targetSamples: number } | undefined,
        private getTileJob?: () => TileJob | undefined
    ) {}

    /**
     * Build session state from current app state
     */
    private _buildSessionState(): SessionData {
        // Collect extension states
        const extensionStates: Record<string, any> = {};
        for (const [name, ext] of this.extensions) {
            if (ext.saveState) {
                extensionStates[name] = ext.saveState();
            }
        }

        const session: SessionData = {
            version: SESSION_VERSION,
            timestamp: Date.now(),
            parameters: this.parameterStore.serialize(),
            rendererId: this.getActiveRendererId(),
            extensions: extensionStates
        };

        // Include active production goal if present
        const productionGoal = this.getProductionGoal?.();
        if (productionGoal) {
            session.productionGoal = productionGoal;
        }

        // Include active tile job if present
        const tileJob = this.getTileJob?.();
        if (tileJob) {
            session.tileJob = tileJob;
        }

        return session;
    }

    /**
     * Save session state
     *
     * Returns a JSON-serializable object that can be stored and
     * passed to restoreSession() later.
     */
    saveSession(): SessionData {
        try {
            const session = this._buildSessionState();
            this.eventBus.emit(AppEvents.SESSION_SAVED, session);
            return session;
        } catch (error) {
            throw new SessionError('Failed to save session', { error });
        }
    }

    /**
     * Restore session state
     *
     * Restores parameters, renderer selection, and extension states.
     * Returns the restored session so callers can check for
     * productionGoal or tileJob and re-queue work.
     */
    restoreSession(session: SessionData): SessionData {
        try {
            // Validate session structure
            if (!session || typeof session !== 'object') {
                throw new SessionError('Invalid session data: expected object', { session });
            }

            // Restore parameters
            if (session.parameters) {
                this.parameterStore.restore(session.parameters);
            }

            // Optionally restore renderer selection
            if (session.rendererId) {
                this.setActiveRendererId(session.rendererId);
            }

            // Restore extension states
            if (session.extensions) {
                for (const [name, state] of Object.entries(session.extensions)) {
                    const ext = this.extensions.get(name);
                    if (ext?.restoreState) {
                        ext.restoreState(state);
                    }
                }
            }

            console.log('Session restored');
            this.eventBus.emit(AppEvents.SESSION_LOADED, session);
            return session;
        } catch (error) {
            if (error instanceof SessionError) {
                throw error;
            }
            throw new SessionError('Failed to restore session', { error });
        }
    }

    /**
     * Quick save session to file download
     *
     * Generates a timestamped filename and triggers a download.
     */
    quickSave(): void {
        try {
            const session = this.saveSession();
            const filename = this._generateSessionFilename();

            const json = JSON.stringify(session, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);

            console.log(`Session saved: ${filename}`);
        } catch (error) {
            throw new SessionError('Failed to quick save session', { error });
        }
    }

    /**
     * Load session from file via file picker dialog
     *
     * Opens a file picker and loads the selected JSON session file.
     */
    loadSessionFromFile(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const session = JSON.parse(text);
                this.restoreSession(session);
                console.log(`Session loaded from: ${file.name}`);
            } catch (error) {
                if (error instanceof SessionError) {
                    throw error;
                }
                throw new SessionError('Failed to load session from file', {
                    filename: file.name,
                    error
                });
            }
        };

        input.click();
    }

    /**
     * Generate timestamped session filename
     */
    private _generateSessionFilename(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        return `session_${year}${month}${day}_${hours}${minutes}${seconds}.json`;
    }
}
