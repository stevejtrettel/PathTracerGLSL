// errors/core/Diagnostic.ts

/**
 * Source location for error reporting
 *
 * Tracks where in the source code a diagnostic occurred.
 * For generated GLSL, can map back to original source via sourceMap.
 */
export interface SourceLocation {
    /** Source file name or identifier (e.g., "main.frag", "pathtracer") */
    file?: string;

    /** 1-based line number */
    line: number;

    /** 1-based column number */
    column?: number;

    /** End line for multi-line spans */
    endLine?: number;

    /** End column for multi-line spans */
    endColumn?: number;

    /** The actual source text at this location (for display) */
    sourceText?: string;

    /** Original location before GLSL generation (for source maps) */
    originalLocation?: {
        source: string;    // "scene.geometry[0]" or "strategy.settings"
        path?: string[];   // ["materials", "0", "albedo"]
    };
}

/**
 * Suggestion for fixing an error
 */
export interface Suggestion {
    /** Human-readable suggestion message */
    message: string;

    /** Optional automatic fix */
    fix?: {
        /** Start offset in source */
        start: number;
        /** End offset in source */
        end: number;
        /** Replacement text */
        replacement: string;
    };
}

/**
 * Diagnostic severity levels
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

/**
 * Diagnostic - A single error, warning, or info message
 *
 * Represents a problem or note discovered during compilation.
 * Designed to accumulate multiple diagnostics before stopping.
 */
export interface Diagnostic {
    /** Severity level */
    severity: DiagnosticSeverity;

    /**
     * Error code identifier
     * Uses string identifiers like 'undefined-function', 'type-mismatch'
     */
    code: string;

    /** Human-readable error message */
    message: string;

    /**
     * Source component that generated this diagnostic
     * e.g., 'compiler', 'engine', 'glsl', 'validator'
     */
    source: string;

    /** Location in source code (if applicable) */
    location?: SourceLocation;

    /** Suggestions for fixing the problem */
    suggestions?: Suggestion[];

    /** Related diagnostics ("see also...") */
    relatedInfo?: Diagnostic[];

    /** Timestamp when diagnostic was created */
    timestamp?: number;
}

/**
 * Create a diagnostic with defaults
 */
export function createDiagnostic(
    severity: DiagnosticSeverity,
    code: string,
    message: string,
    source: string
): Diagnostic {
    return {
        severity,
        code,
        message,
        source,
        timestamp: Date.now()
    };
}

/**
 * Check if a diagnostic is an error (blocks compilation)
 */
export function isError(diagnostic: Diagnostic): boolean {
    return diagnostic.severity === 'error';
}

/**
 * Check if a diagnostic is actionable (error or warning)
 */
export function isActionable(diagnostic: Diagnostic): boolean {
    return diagnostic.severity === 'error' || diagnostic.severity === 'warning';
}

/**
 * Compare diagnostics for sorting (errors first, then by location)
 */
export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
    // Errors before warnings before info before hints
    const severityOrder = { error: 0, warning: 1, info: 2, hint: 3 };
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;

    // Then by file
    const fileA = a.location?.file ?? '';
    const fileB = b.location?.file ?? '';
    if (fileA !== fileB) return fileA.localeCompare(fileB);

    // Then by line
    const lineA = a.location?.line ?? 0;
    const lineB = b.location?.line ?? 0;
    return lineA - lineB;
}
