// app/ParameterStore.ts — Central parameter storage with change notification
import type { ParameterChanges } from './types';

class ParameterStore {
    private parameters = new Map<string, any>();
    private locked = false;
    private _onChange: ((changes: ParameterChanges) => void) | null = null;

    // Setting onChange immediately syncs all existing parameters
    set onChange(callback: ((changes: ParameterChanges) => void) | null) {
        this._onChange = callback;
        if (callback && this.parameters.size > 0) {
            callback({
                changes: Array.from(this.parameters.entries()).map(([path, value]) => ({
                    path, oldValue: undefined, newValue: value
                }))
            });
        }
    }

    get onChange() { return this._onChange; }

    lock(): void { this.locked = true; }
    unlock(): void { this.locked = false; }
    isLocked(): boolean { return this.locked; }

    set(path: string, value: any): void {
        if (this.locked) {
            console.warn(`Ignoring parameter change during production: ${path}`);
            return;
        }

        const oldValue = this.parameters.get(path);
        if (this.valuesEqual(oldValue, value)) return;

        this.parameters.set(path, value);
        this._onChange?.({ changes: [{ path, oldValue, newValue: value }] });
    }

    batch(updates: Record<string, any>): void {
        if (this.locked) {
            console.warn('Ignoring batch parameter update during production');
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

        if (changes.length > 0) this._onChange?.({ changes });
    }

    get(path: string): any { return this.parameters.get(path); }

    // Force re-send all parameters (for renderer switching)
    resendAll(): void {
        if (!this._onChange || this.parameters.size === 0) return;
        this._onChange({
            changes: Array.from(this.parameters.entries()).map(([path, value]) => ({
                path, oldValue: value, newValue: value
            }))
        });
    }

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

    // Restore parameters from session (suppresses individual change notifications)
    restore(params: Record<string, any>): void {
        const oldOnChange = this._onChange;
        this._onChange = null;
        this.parameters.clear();

        for (const [key, value] of Object.entries(params)) {
            if (key === 'camera.frame' && Array.isArray(value)) {
                this.parameters.set(key, new Float32Array(value));
            } else if (Array.isArray(value)) {
                this.parameters.set(key, [...value]);
            } else {
                this.parameters.set(key, value);
            }
        }

        this._onChange = oldOnChange;

        // Send all parameters in one batch
        this._onChange?.({
            changes: Array.from(this.parameters.entries()).map(([path, value]) => ({
                path, oldValue: undefined, newValue: value
            }))
        });
    }

    private valuesEqual(a: any, b: any): boolean {
        if (a === b) return true;
        if ((Array.isArray(a) || ArrayBuffer.isView(a)) &&
            (Array.isArray(b) || ArrayBuffer.isView(b))) {
            const arrA = a as ArrayLike<number>;
            const arrB = b as ArrayLike<number>;
            if (arrA.length !== arrB.length) return false;
            for (let i = 0; i < arrA.length; i++) {
                if (arrA[i] !== arrB[i]) return false;
            }
            return true;
        }
        return false;
    }
}

export { ParameterStore };
