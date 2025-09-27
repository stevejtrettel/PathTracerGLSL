// Types for the parameter system - Phase 2 minimal but correct

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
