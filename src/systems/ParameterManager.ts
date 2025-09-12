// src/systems/ParameterManager.ts

import type { ParameterDescriptor, ParameterView } from "../core/types";

/**
 * Internal storage for a parameter
 */
interface ParameterEntry {
    descriptor: ParameterDescriptor;
    value: any;
    listeners: Set<(value: any, old: any) => void>;
}

/**
 * ParameterManager
 *
 * Central registry for all parameters in the system.
 * - Stores parameter descriptors and current values
 * - Provides scoped views for plugins
 * - Handles change notifications
 * - Type-safe access with runtime validation
 */
export default class ParameterManager {
    // Hierarchical storage: namespace -> parameter name -> entry
    private parameters = new Map<string, Map<string, ParameterEntry>>();

    // Global change listeners (e.g., for accumulation reset)
    private globalListeners = new Set<(namespace: string, name: string, value: any, old: any) => void>();

    /**
     * Register parameters for a plugin
     */
    registerParameters(namespace: string, descriptors: ParameterDescriptor[]): void {
        if (!this.parameters.has(namespace)) {
            this.parameters.set(namespace, new Map());
        }

        const nsParams = this.parameters.get(namespace)!;

        for (const desc of descriptors) {
            // Initialize with default value if not already set
            if (!nsParams.has(desc.name)) {
                nsParams.set(desc.name, {
                    descriptor: desc,
                    value: desc.default,
                    listeners: new Set()
                });
            } else {
                // Update descriptor but preserve current value
                const entry = nsParams.get(desc.name)!;
                entry.descriptor = desc;
            }
        }
    }

    /**
     * Get a scoped view for a specific namespace
     */
    getView(namespace: string): ParameterView {
        return new ParameterViewImpl(this, namespace);
    }

    /**
     * Set a parameter value
     */
    set(namespace: string, name: string, value: any): void {
        const nsParams = this.parameters.get(namespace);
        if (!nsParams) {
            console.warn(`ParameterManager: namespace "${namespace}" not found`);
            return;
        }

        const entry = nsParams.get(name);
        if (!entry) {
            console.warn(`ParameterManager: parameter "${namespace}.${name}" not found`);
            return;
        }

        const old = entry.value;
        if (old === value) return; // No change

        // Validate against constraints
        if (this.validateValue(entry.descriptor, value)) {
            entry.value = value;

            // Notify parameter-specific listeners
            for (const listener of entry.listeners) {
                listener(value, old);
            }

            // Notify global listeners
            for (const listener of this.globalListeners) {
                listener(namespace, name, value, old);
            }
        }
    }

    /**
     * Get a parameter value
     */
    get(namespace: string, name: string): any {
        const nsParams = this.parameters.get(namespace);
        if (!nsParams) return undefined;

        const entry = nsParams.get(name);
        return entry?.value;
    }

    /**
     * Check if a parameter exists
     */
    has(namespace: string, name: string): boolean {
        const nsParams = this.parameters.get(namespace);
        if (!nsParams) return false;
        return nsParams.has(name);
    }

    /**
     * Add a change listener for a specific parameter
     */
    addListener(namespace: string, name: string, callback: (value: any, old: any) => void): void {
        const nsParams = this.parameters.get(namespace);
        if (!nsParams) return;

        const entry = nsParams.get(name);
        if (entry) {
            entry.listeners.add(callback);
        }
    }

    /**
     * Remove a change listener
     */
    removeListener(namespace: string, name: string, callback: (value: any, old: any) => void): void {
        const nsParams = this.parameters.get(namespace);
        if (!nsParams) return;

        const entry = nsParams.get(name);
        if (entry) {
            entry.listeners.delete(callback);
        }
    }

    /**
     * Add a global listener (notified of all parameter changes)
     */
    addGlobalListener(callback: (namespace: string, name: string, value: any, old: any) => void): void {
        this.globalListeners.add(callback);
    }

    /**
     * Get all parameters for a namespace (useful for UI generation)
     */
    getNamespaceParameters(namespace: string): ParameterDescriptor[] {
        const nsParams = this.parameters.get(namespace);
        if (!nsParams) return [];

        return Array.from(nsParams.values()).map(entry => entry.descriptor);
    }

    /**
     * Get all namespaces (useful for UI organization)
     */
    getNamespaces(): string[] {
        return Array.from(this.parameters.keys());
    }

    /**
     * Serialize all parameter values (for save/restore)
     */
    serialize(): Record<string, Record<string, any>> {
        const result: Record<string, Record<string, any>> = {};

        for (const [namespace, nsParams] of this.parameters) {
            result[namespace] = {};
            for (const [name, entry] of nsParams) {
                if (entry.descriptor.persistent !== false) {
                    result[namespace][name] = entry.value;
                }
            }
        }

        return result;
    }

    /**
     * Restore parameter values from serialized data
     */
    deserialize(data: Record<string, Record<string, any>>): void {
        for (const [namespace, params] of Object.entries(data)) {
            for (const [name, value] of Object.entries(params)) {
                this.set(namespace, name, value);
            }
        }
    }

    /**
     * Validate a value against parameter constraints
     */
    private validateValue(descriptor: ParameterDescriptor, value: any): boolean {
        // Type checking
        switch (descriptor.type) {
            case 'float':
            case 'angle':
                if (typeof value !== 'number') {
                    console.warn(`Parameter validation: expected number, got ${typeof value}`);
                    return false;
                }
                break;
            case 'int':
                if (typeof value !== 'number' || !Number.isInteger(value)) {
                    console.warn(`Parameter validation: expected integer, got ${value}`);
                    return false;
                }
                break;
            case 'boolean':
                if (typeof value !== 'boolean') {
                    console.warn(`Parameter validation: expected boolean, got ${typeof value}`);
                    return false;
                }
                break;
            case 'vec2':
                if (!Array.isArray(value) || value.length !== 2) {
                    console.warn(`Parameter validation: expected vec2 array`);
                    return false;
                }
                break;
            case 'vec3':
            case 'color':
                if (!Array.isArray(value) || value.length !== 3) {
                    console.warn(`Parameter validation: expected vec3 array`);
                    return false;
                }
                break;
        }

        // Range checking for numeric types
        if (typeof value === 'number') {
            if (descriptor.min !== undefined && value < descriptor.min) {
                console.warn(`Parameter validation: value ${value} below min ${descriptor.min}`);
                return false;
            }
            if (descriptor.max !== undefined && value > descriptor.max) {
                console.warn(`Parameter validation: value ${value} above max ${descriptor.max}`);
                return false;
            }
        }

        // Options checking
        if (descriptor.options && !descriptor.options.includes(value)) {
            console.warn(`Parameter validation: value ${value} not in options`, descriptor.options);
            return false;
        }

        return true;
    }
}

/**
 * Implementation of ParameterView for a specific namespace
 */
class ParameterViewImpl implements ParameterView {
    constructor(
        private manager: ParameterManager,
        private namespace: string
    ) {}

    get(name: string): any {
        return this.manager.get(this.namespace, name);
    }

    has(name: string): boolean {
        return this.manager.has(this.namespace, name);
    }

    onChange(name: string, callback: (value: any, old: any) => void): void {
        this.manager.addListener(this.namespace, name, callback);
    }

    offChange(name: string, callback: (value: any, old: any) => void): void {
        this.manager.removeListener(this.namespace, name, callback);
    }
}
