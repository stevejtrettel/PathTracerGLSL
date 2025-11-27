// errors/RenderErrors.ts
// Typed error hierarchy for render operations

/**
 * Base class for all render-related errors
 */
export class RenderError extends Error {
    constructor(message: string, public details?: any) {
        super(message);
        this.name = 'RenderError';
        // Maintain proper prototype chain
        Object.setPrototypeOf(this, RenderError.prototype);
    }
}

/**
 * Error during shader compilation or pipeline compilation
 */
export class CompilationError extends RenderError {
    constructor(message: string, details?: any) {
        super(message, details);
        this.name = 'CompilationError';
        Object.setPrototypeOf(this, CompilationError.prototype);
    }
}

/**
 * Error during GPU resource creation or management
 */
export class ResourceError extends RenderError {
    constructor(message: string, details?: any) {
        super(message, details);
        this.name = 'ResourceError';
        Object.setPrototypeOf(this, ResourceError.prototype);
    }
}

/**
 * Error during parameter validation or setting
 */
export class ParameterError extends RenderError {
    constructor(message: string, details?: any) {
        super(message, details);
        this.name = 'ParameterError';
        Object.setPrototypeOf(this, ParameterError.prototype);
    }
}

/**
 * Error during file export operations
 */
export class ExportError extends RenderError {
    constructor(message: string, details?: any) {
        super(message, details);
        this.name = 'ExportError';
        Object.setPrototypeOf(this, ExportError.prototype);
    }
}

/**
 * Error during session save/restore operations
 */
export class SessionError extends RenderError {
    constructor(message: string, details?: any) {
        super(message, details);
        this.name = 'SessionError';
        Object.setPrototypeOf(this, SessionError.prototype);
    }
}

/**
 * Error when render is stopped (for production render interruption)
 */
export class RenderStoppedError extends RenderError {
    constructor(message: string = 'Production render stopped', details?: any) {
        super(message, details);
        this.name = 'RenderStoppedError';
        Object.setPrototypeOf(this, RenderStoppedError.prototype);
    }
}

/**
 * Error during HDR environment loading
 */
export class EnvironmentLoadError extends RenderError {
    constructor(message: string, details?: any) {
        super(message, details);
        this.name = 'EnvironmentLoadError';
        Object.setPrototypeOf(this, EnvironmentLoadError.prototype);
    }
}
