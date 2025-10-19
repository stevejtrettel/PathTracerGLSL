// Types for the parameter system - Phase 2 minimal but correct

import type { ModuleDescriptor } from '../engine/types';


export interface RenderConfiguration {
    name: string;
    description?: string;

    modules: {
        ambient: ModuleDescriptor;
        scene: ModuleDescriptor;
        environment: ModuleDescriptor;
        lighting: ModuleDescriptor;
        camera: ModuleDescriptor;
        interaction: ModuleDescriptor;
        transport: ModuleDescriptor;
        accumulator: ModuleDescriptor;
        developer: ModuleDescriptor;
    };

    parameters: Record<string, any>;

    environmentMap?: {
        path: string;
        intensity?: number;
        rotation?: number;
    };
}



/**
 * Metadata about a parameter for validation and UI
 */
interface ParameterMetadata {
    type: 'float' | 'vec3' | 'int' | 'bool';
    default: any;
    min?: number;
    max?: number;
}

/**
 * Single parameter change
 */
interface ParameterChange {
    path: string;          // "camera.position"
    oldValue: any;
    newValue: any;
}

/**
 * Batch of parameter changes
 */
interface ParameterChanges {
    changes: ParameterChange[];
}


export type {
    ParameterMetadata,
    ParameterChange,
    ParameterChanges,
};
