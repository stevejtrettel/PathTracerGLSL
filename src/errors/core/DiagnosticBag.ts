// errors/core/DiagnosticBag.ts

import type {
    Diagnostic,
    DiagnosticSeverity,
    SourceLocation,
    Suggestion
} from './Diagnostic.js';
import { createDiagnostic, compareDiagnostics } from './Diagnostic.js';

/**
 * DiagnosticBuilder - Fluent API for constructing diagnostics
 *
 * Usage:
 *   bag.error('undefined-function', 'Function "foo" is not defined')
 *      .at({ file: 'main.frag', line: 42, column: 10 })
 *      .suggest('Did you mean "bar"?')
 *      .add();
 */
export class DiagnosticBuilder {
    private diagnostic: Diagnostic;
    private bag: DiagnosticBag;

    constructor(bag: DiagnosticBag, severity: DiagnosticSeverity, code: string, message: string, source: string) {
        this.bag = bag;
        this.diagnostic = createDiagnostic(severity, code, message, source);
    }

    /**
     * Set the source location
     */
    at(location: SourceLocation): this {
        this.diagnostic.location = location;
        return this;
    }

    /**
     * Set location by file and line (convenience)
     */
    atLine(file: string, line: number, column?: number): this {
        this.diagnostic.location = { file, line, column };
        return this;
    }

    /**
     * Add a suggestion
     */
    suggest(message: string, fix?: Suggestion['fix']): this {
        if (!this.diagnostic.suggestions) {
            this.diagnostic.suggestions = [];
        }
        this.diagnostic.suggestions.push({ message, fix });
        return this;
    }

    /**
     * Add related diagnostic info
     */
    relatedTo(diagnostic: Diagnostic): this {
        if (!this.diagnostic.relatedInfo) {
            this.diagnostic.relatedInfo = [];
        }
        this.diagnostic.relatedInfo.push(diagnostic);
        return this;
    }

    /**
     * Add source text for display
     */
    withSourceText(text: string): this {
        if (!this.diagnostic.location) {
            this.diagnostic.location = { line: 0 };
        }
        this.diagnostic.location.sourceText = text;
        return this;
    }

    /**
     * Add original location (for source maps)
     */
    withOriginal(source: string, path?: string[]): this {
        if (!this.diagnostic.location) {
            this.diagnostic.location = { line: 0 };
        }
        this.diagnostic.location.originalLocation = { source, path };
        return this;
    }

    /**
     * Add the diagnostic to the bag
     */
    add(): Diagnostic {
        this.bag._addDiagnostic(this.diagnostic);
        return this.diagnostic;
    }

    /**
     * Get the diagnostic without adding to bag
     */
    build(): Diagnostic {
        return this.diagnostic;
    }
}

/**
 * DiagnosticBag - Collects multiple diagnostics
 *
 * Key features:
 * - Accumulates errors and warnings without stopping early
 * - Fluent builder API for constructing diagnostics
 * - Query methods to check for errors/warnings
 * - Merge support for combining diagnostics from phases
 *
 * Usage:
 *   const bag = new DiagnosticBag('compiler');
 *
 *   bag.error('undefined-function', 'Function "foo" is not defined')
 *      .atLine('main.frag', 42)
 *      .suggest('Did you mean "bar"?')
 *      .add();
 *
 *   if (bag.hasErrors()) {
 *       throw new CompilationError(bag);
 *   }
 */
export class DiagnosticBag {
    private diagnostics: Diagnostic[] = [];
    private defaultSource: string;

    constructor(source: string = 'unknown') {
        this.defaultSource = source;
    }

    // ========================================================================
    // Builder Methods (fluent API)
    // ========================================================================

    /**
     * Start building an error diagnostic
     */
    error(code: string, message: string): DiagnosticBuilder {
        return new DiagnosticBuilder(this, 'error', code, message, this.defaultSource);
    }

    /**
     * Start building a warning diagnostic
     */
    warning(code: string, message: string): DiagnosticBuilder {
        return new DiagnosticBuilder(this, 'warning', code, message, this.defaultSource);
    }

    /**
     * Start building an info diagnostic
     */
    info(code: string, message: string): DiagnosticBuilder {
        return new DiagnosticBuilder(this, 'info', code, message, this.defaultSource);
    }

    /**
     * Start building a hint diagnostic
     */
    hint(code: string, message: string): DiagnosticBuilder {
        return new DiagnosticBuilder(this, 'hint', code, message, this.defaultSource);
    }

    // ========================================================================
    // Direct Add Methods (for simpler cases)
    // ========================================================================

    /**
     * Add a simple error (no location/suggestions)
     */
    addError(code: string, message: string): Diagnostic {
        return this.error(code, message).add();
    }

    /**
     * Add a simple warning (no location/suggestions)
     */
    addWarning(code: string, message: string): Diagnostic {
        return this.warning(code, message).add();
    }

    /**
     * Add an existing diagnostic
     */
    addDiagnostic(diagnostic: Diagnostic): void {
        this._addDiagnostic(diagnostic);
    }

    /**
     * Internal: Add diagnostic to collection
     * @internal
     */
    _addDiagnostic(diagnostic: Diagnostic): void {
        this.diagnostics.push(diagnostic);
    }

    // ========================================================================
    // Query Methods
    // ========================================================================

    /**
     * Check if there are any errors
     */
    hasErrors(): boolean {
        return this.diagnostics.some(d => d.severity === 'error');
    }

    /**
     * Check if there are any warnings
     */
    hasWarnings(): boolean {
        return this.diagnostics.some(d => d.severity === 'warning');
    }

    /**
     * Check if there are any diagnostics
     */
    isEmpty(): boolean {
        return this.diagnostics.length === 0;
    }

    /**
     * Get count of diagnostics by severity
     */
    count(severity?: DiagnosticSeverity): number {
        if (!severity) return this.diagnostics.length;
        return this.diagnostics.filter(d => d.severity === severity).length;
    }

    /**
     * Get all diagnostics
     */
    getAll(): Diagnostic[] {
        return [...this.diagnostics];
    }

    /**
     * Get all diagnostics sorted (errors first, then by location)
     */
    getSorted(): Diagnostic[] {
        return [...this.diagnostics].sort(compareDiagnostics);
    }

    /**
     * Get only errors
     */
    getErrors(): Diagnostic[] {
        return this.diagnostics.filter(d => d.severity === 'error');
    }

    /**
     * Get only warnings
     */
    getWarnings(): Diagnostic[] {
        return this.diagnostics.filter(d => d.severity === 'warning');
    }

    /**
     * Get diagnostics for a specific file
     */
    getForFile(file: string): Diagnostic[] {
        return this.diagnostics.filter(d => d.location?.file === file);
    }

    // ========================================================================
    // Manipulation Methods
    // ========================================================================

    /**
     * Merge diagnostics from another bag
     */
    merge(other: DiagnosticBag): void {
        this.diagnostics.push(...other.diagnostics);
    }

    /**
     * Clear all diagnostics
     */
    clear(): void {
        this.diagnostics = [];
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Get summary string (e.g., "3 errors, 2 warnings")
     */
    getSummary(): string {
        const errorCount = this.count('error');
        const warningCount = this.count('warning');

        const parts: string[] = [];
        if (errorCount > 0) {
            parts.push(`${errorCount} error${errorCount !== 1 ? 's' : ''}`);
        }
        if (warningCount > 0) {
            parts.push(`${warningCount} warning${warningCount !== 1 ? 's' : ''}`);
        }

        return parts.length > 0 ? parts.join(', ') : 'no issues';
    }

    /**
     * Throw if there are errors
     */
    throwIfErrors(): void {
        if (this.hasErrors()) {
            throw new CompilationError(this);
        }
    }
}

/**
 * CompilationError - Thrown when compilation fails
 *
 * Wraps a DiagnosticBag for error handling.
 */
export class CompilationError extends Error {
    readonly diagnostics: DiagnosticBag;

    constructor(diagnostics: DiagnosticBag) {
        const summary = diagnostics.getSummary();
        super(`Compilation failed: ${summary}`);
        this.name = 'CompilationError';
        this.diagnostics = diagnostics;
    }

    /**
     * Get all error diagnostics
     */
    getErrors(): Diagnostic[] {
        return this.diagnostics.getErrors();
    }

    /**
     * Get all diagnostics
     */
    getAll(): Diagnostic[] {
        return this.diagnostics.getAll();
    }
}
