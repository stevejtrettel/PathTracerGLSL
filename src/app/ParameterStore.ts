// app/ParameterStore.ts
import type { ParameterChanges } from './types';
import type { RenderCoordinator } from './RenderCoordinator';

/**
 * ParameterStore - Central parameter storage and change notification
 *
 * Responsibilities:
 * - Store parameter values (numbers, vectors, arrays, etc.)
 * - Notify listeners when parameters change
 * - Batch updates to reduce notifications
 * - Serialize/restore for session management
 * - Handle recipe switching (resend all parameters)
 */
class ParameterStore {
    private parameters = new Map<string, any>();
    private suppressNotifications = false;
    private _onChange: ((changes: ParameterChanges) => void) | null = null;
    private coordinator: RenderCoordinator | null = null;

    /**
     * Set render coordinator (for lock state queries)
     */
    setCoordinator(coordinator: RenderCoordinator): void {
        this.coordinator = coordinator;
    }

    /**
     * Set change callback - immediately syncs all existing parameters
     */
    set onChange(callback: ((changes: ParameterChanges) => void) | null) {
        this._onChange = callback;

        if (callback && this.parameters.size > 0) {
            this.notify({
                changes: Array.from(this.parameters.entries()).map(([path, value]) => ({
                    path,
                    oldValue: undefined,
                    newValue: value
                }))
            });
        }
    }

    get onChange() {
        return this._onChange;
    }

    /**
     * Check if parameters are locked (queries RenderCoordinator)
     */
    isLocked(): boolean {
        return this.coordinator?.isLocked() ?? false;
    }

    /**
     * Set single parameter
     */
    set(path: string, value: any): void {
        if (this.isLocked()) {
            console.warn(`⚠️ Ignoring parameter change during production: ${path}`);
            return;
        }

        const oldValue = this.parameters.get(path);

        if (this.valuesEqual(oldValue, value)) return;

        this.parameters.set(path, value);

        this.notify({
            changes: [{ path, oldValue, newValue: value }]
        });
    }

    /**
     * Set multiple parameters in batch
     */
    batch(updates: Record<string, any>): void {
        if (this.isLocked()) {
            console.warn(`⚠️ Ignoring batch parameter update during production`);
            return;
        }

        const changes = [];

        for (const [path, value] of Object.entries(updates)) {
            const oldValue = this.parameters.get(path);

            if (!this.valuesEqual(oldValue, value)) {
                this.parameters.set(path, value);
                changes.push({ path, oldValue, newValue: value });
            }
        }

        if (changes.length > 0) {
            this.notify({ changes });
        }
    }

    /**
     * Get parameter value
     */
    get(path: string): any {
        return this.parameters.get(path);
    }

    /**
     * Force re-send all parameters (for recipe switching)
     */
    resendAll(): void {
        if (this.parameters.size === 0) return;

        this.notify({
            changes: Array.from(this.parameters.entries()).map(([path, value]) => ({
                path,
                oldValue: value,
                newValue: value
            }))
        });
    }

    /**
     * Serialize all parameters for session saving
     */
    serialize(): Record<string, any> {
        const obj: Record<string, any> = {};

        for (const [key, value] of this.parameters.entries()) {
            if (value instanceof Float32Array || value instanceof Array) {
                obj[key] = Array.from(value);
            } else if (value && typeof value === 'object') {
                obj[key] = JSON.parse(JSON.stringify(value));
            } else {
                obj[key] = value;
            }
        }

        return obj;
    }

    /**
     * Restore parameters from session (without triggering individual changes)
     */
    restore(params: Record<string, any>): void {
        // Suppress notifications while loading
        this.suppressNotifications = true;

        this.parameters.clear();

        for (const [key, value] of Object.entries(params)) {
            // Convert arrays to Float32Array for camera.frame
            if (key === 'camera.frame' && Array.isArray(value)) {
                this.parameters.set(key, new Float32Array(value));
            } else if (Array.isArray(value)) {
                this.parameters.set(key, [...value]);
            } else {
                this.parameters.set(key, value);
            }
        }

        this.suppressNotifications = false;

        // Send all parameters in one batch
        this.notify({
            changes: Array.from(this.parameters.entries()).map(([path, value]) => ({
                path,
                oldValue: undefined,
                newValue: value
            }))
        });
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    private notify(changes: ParameterChanges): void {
        if (this.suppressNotifications || !this._onChange) return;
        this._onChange(changes);
    }

    private valuesEqual(a: any, b: any): boolean {
        if (a === b) return true;

        // Handle arrays and typed arrays
        if ((Array.isArray(a) || ArrayBuffer.isView(a)) &&
            (Array.isArray(b) || ArrayBuffer.isView(b))) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (a[i] !== b[i]) return false;
            }
            return true;
        }

        return false;
    }
}

export { ParameterStore };
