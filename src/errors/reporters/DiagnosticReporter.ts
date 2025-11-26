// errors/formatters/DiagnosticReporter.ts

import type { Diagnostic, DiagnosticSeverity } from '../core/Diagnostic.js';
import type { DiagnosticBag } from '../core/DiagnosticBag.js';

/**
 * DiagnosticReporter - Base interface for formatting diagnostics
 *
 * Implementations produce output for different targets:
 * - ConsoleReporter: Pretty terminal output
 * - HTMLReporter: Rich HTML for web overlay
 * - JSONReporter: Machine-readable output
 */
export interface DiagnosticReporter {
    /**
     * Format a single diagnostic
     */
    formatDiagnostic(diagnostic: Diagnostic): string;

    /**
     * Format all diagnostics from a bag
     */
    formatBag(bag: DiagnosticBag): string;

    /**
     * Format a summary line
     */
    formatSummary(bag: DiagnosticBag): string;
}

/**
 * ANSI color codes for terminal output
 */
const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',

    // Foreground colors
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',

    // Bright colors
    brightRed: '\x1b[91m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightCyan: '\x1b[96m',
};

/**
 * Box drawing characters for pretty output
 */
const BOX = {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
    verticalRight: '├',
    arrow: '>',
};

/**
 * Get color for severity level
 */
function getSeverityColor(severity: DiagnosticSeverity, useColor: boolean): string {
    if (!useColor) return '';
    switch (severity) {
        case 'error': return ANSI.brightRed;
        case 'warning': return ANSI.brightYellow;
        case 'info': return ANSI.brightBlue;
        case 'hint': return ANSI.brightCyan;
        default: return ANSI.white;
    }
}

/**
 * Get label for severity level
 */
function getSeverityLabel(severity: DiagnosticSeverity): string {
    return severity.toUpperCase();
}

/**
 * ConsoleReporter - Pretty terminal output for diagnostics
 *
 * Produces beautiful, readable error output like:
 *
 * ╭─ ERROR undefined-function: Function "getMateril" is not defined
 * │
 * │  pathtracer.frag:142:21
 * │
 * │    141 │     Hit hit = traceRay(ray);
 * │  > 142 │     Material mat = getMateril(hit.materialId);
 * │        │                     ^^^^^^^^^^
 * │    143 │     return shade(hit, mat, ray);
 * │
 * │  Did you mean: getMaterial?
 * │
 * ╰─────────────────────────────────────────────────
 */
export class ConsoleReporter implements DiagnosticReporter {
    private useColor: boolean;
    private contextLines: number;

    constructor(options?: { useColor?: boolean; contextLines?: number }) {
        this.useColor = options?.useColor ?? true;
        this.contextLines = options?.contextLines ?? 2;
    }

    formatDiagnostic(diagnostic: Diagnostic): string {
        const lines: string[] = [];
        const color = getSeverityColor(diagnostic.severity, this.useColor);
        const reset = this.useColor ? ANSI.reset : '';
        const dim = this.useColor ? ANSI.dim : '';
        const bold = this.useColor ? ANSI.bold : '';

        // Header line
        const label = getSeverityLabel(diagnostic.severity);
        lines.push(`${color}${BOX.topLeft}${BOX.horizontal} ${bold}${label}${reset}${color} ${diagnostic.code}: ${diagnostic.message}${reset}`);
        lines.push(`${color}${BOX.vertical}${reset}`);

        // Location line
        if (diagnostic.location) {
            const loc = diagnostic.location;
            let locationStr = '';
            if (loc.file) locationStr += loc.file;
            if (loc.line) locationStr += `:${loc.line}`;
            if (loc.column) locationStr += `:${loc.column}`;

            if (locationStr) {
                lines.push(`${color}${BOX.vertical}${reset}  ${dim}${locationStr}${reset}`);
                lines.push(`${color}${BOX.vertical}${reset}`);
            }

            // Source code snippet
            if (loc.sourceText) {
                const sourceLines = this.formatSourceSnippet(diagnostic);
                for (const sourceLine of sourceLines) {
                    lines.push(`${color}${BOX.vertical}${reset}${sourceLine}`);
                }
                lines.push(`${color}${BOX.vertical}${reset}`);
            }

            // Original location (source map)
            if (loc.originalLocation) {
                const orig = loc.originalLocation;
                let origStr = `  ${dim}From: ${orig.source}`;
                if (orig.path && orig.path.length > 0) {
                    origStr += ` (${orig.path.join('.')})`;
                }
                origStr += reset;
                lines.push(`${color}${BOX.vertical}${reset}${origStr}`);
                lines.push(`${color}${BOX.vertical}${reset}`);
            }
        }

        // Suggestions
        if (diagnostic.suggestions && diagnostic.suggestions.length > 0) {
            for (const suggestion of diagnostic.suggestions) {
                const cyan = this.useColor ? ANSI.cyan : '';
                lines.push(`${color}${BOX.vertical}${reset}  ${cyan}${suggestion.message}${reset}`);
            }
            lines.push(`${color}${BOX.vertical}${reset}`);
        }

        // Related diagnostics
        if (diagnostic.relatedInfo && diagnostic.relatedInfo.length > 0) {
            lines.push(`${color}${BOX.vertical}${reset}  ${dim}Related:${reset}`);
            for (const related of diagnostic.relatedInfo) {
                const relatedLoc = related.location;
                let relatedStr = `    - ${related.message}`;
                if (relatedLoc?.file) {
                    relatedStr += ` (${relatedLoc.file}:${relatedLoc.line})`;
                }
                lines.push(`${color}${BOX.vertical}${reset}${dim}${relatedStr}${reset}`);
            }
            lines.push(`${color}${BOX.vertical}${reset}`);
        }

        // Footer
        const footerWidth = 50;
        lines.push(`${color}${BOX.bottomLeft}${BOX.horizontal.repeat(footerWidth)}${reset}`);

        return lines.join('\n');
    }

    formatBag(bag: DiagnosticBag): string {
        const sorted = bag.getSorted();
        if (sorted.length === 0) {
            return '';
        }

        const parts: string[] = [];

        for (const diagnostic of sorted) {
            parts.push(this.formatDiagnostic(diagnostic));
            parts.push(''); // Blank line between diagnostics
        }

        parts.push(this.formatSummary(bag));

        return parts.join('\n');
    }

    formatSummary(bag: DiagnosticBag): string {
        const errorCount = bag.count('error');
        const warningCount = bag.count('warning');

        const parts: string[] = [];

        if (errorCount > 0) {
            const color = this.useColor ? ANSI.brightRed : '';
            const reset = this.useColor ? ANSI.reset : '';
            parts.push(`${color}${errorCount} error${errorCount !== 1 ? 's' : ''}${reset}`);
        }

        if (warningCount > 0) {
            const color = this.useColor ? ANSI.brightYellow : '';
            const reset = this.useColor ? ANSI.reset : '';
            parts.push(`${color}${warningCount} warning${warningCount !== 1 ? 's' : ''}${reset}`);
        }

        if (parts.length === 0) {
            const color = this.useColor ? ANSI.cyan : '';
            const reset = this.useColor ? ANSI.reset : '';
            return `${color}No issues found.${reset}`;
        }

        return parts.join(', ');
    }

    /**
     * Format source code snippet with line numbers and pointer
     */
    private formatSourceSnippet(diagnostic: Diagnostic): string[] {
        const loc = diagnostic.location;
        if (!loc || !loc.sourceText) return [];

        const lines: string[] = [];
        const sourceLines = loc.sourceText.split('\n');
        const errorLine = loc.line;
        const errorCol = loc.column ?? 1;

        // Calculate which lines to show
        const startLine = Math.max(1, errorLine - this.contextLines);
        const endLine = Math.min(sourceLines.length, errorLine + this.contextLines);

        // Width for line numbers
        const lineNumWidth = String(endLine).length;

        const dim = this.useColor ? ANSI.dim : '';
        const reset = this.useColor ? ANSI.reset : '';
        const color = getSeverityColor(diagnostic.severity, this.useColor);

        for (let i = startLine; i <= endLine; i++) {
            const sourceLine = sourceLines[i - 1] ?? '';
            const lineNum = String(i).padStart(lineNumWidth);
            const isErrorLine = i === errorLine;

            if (isErrorLine) {
                // Error line with marker
                lines.push(`  ${color}${BOX.arrow}${reset} ${dim}${lineNum}${reset} ${BOX.vertical}     ${sourceLine}`);

                // Pointer line
                if (errorCol > 0) {
                    const padding = ' '.repeat(errorCol - 1 + 5); // Account for prefix
                    const pointerChar = '^';
                    // Try to determine pointer length from context
                    const pointerLen = this.guessPointerLength(sourceLine, errorCol);
                    const pointer = pointerChar.repeat(pointerLen);
                    lines.push(`    ${' '.repeat(lineNumWidth)} ${BOX.vertical}${padding}${color}${pointer}${reset}`);
                }
            } else {
                // Context line
                lines.push(`    ${dim}${lineNum}${reset} ${BOX.vertical}     ${sourceLine}`);
            }
        }

        return lines;
    }

    /**
     * Guess length of pointer based on token at position
     */
    private guessPointerLength(line: string, column: number): number {
        // Find the identifier/token starting at column
        const rest = line.slice(column - 1);
        const match = rest.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
        if (match) {
            return match[0].length;
        }
        return 1;
    }
}

/**
 * JSONReporter - Machine-readable JSON output
 */
export class JSONReporter implements DiagnosticReporter {
    formatDiagnostic(diagnostic: Diagnostic): string {
        return JSON.stringify(diagnostic, null, 2);
    }

    formatBag(bag: DiagnosticBag): string {
        return JSON.stringify({
            diagnostics: bag.getAll(),
            summary: {
                errors: bag.count('error'),
                warnings: bag.count('warning'),
                info: bag.count('info'),
                hints: bag.count('hint')
            }
        }, null, 2);
    }

    formatSummary(bag: DiagnosticBag): string {
        return JSON.stringify({
            errors: bag.count('error'),
            warnings: bag.count('warning')
        });
    }
}
