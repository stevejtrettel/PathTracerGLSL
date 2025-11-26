// errors/core/index.ts

export type {
    Diagnostic,
    DiagnosticSeverity,
    SourceLocation,
    Suggestion
} from './Diagnostic.js';

export {
    createDiagnostic,
    isError,
    isActionable,
    compareDiagnostics
} from './Diagnostic.js';

export {
    DiagnosticBag,
    DiagnosticBuilder,
    CompilationError
} from './DiagnosticBag.js';

export {
    GLSL_ERRORS,
    GLSL_WARNINGS,
    SCENE_ERRORS,
    STRATEGY_ERRORS,
    ENGINE_ERRORS,
    RESOURCE_ERRORS,
    VALIDATION_ERRORS,
    ALL_ERROR_CODES,
    getErrorDefinition,
    isKnownCode,
    type ErrorCodeDefinition
} from './codes.js';
