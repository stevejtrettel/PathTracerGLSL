import type { ShaderDiagnostics, TranslatedError, FormatOptions } from '../types.js';
import { DEFAULT_FORMAT_OPTIONS } from '../types.js';

/**
 * ANSI color codes for terminal output
 */
const COLORS = {
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    green: '\x1b[32m',
    gray: '\x1b[90m',
    bold: '\x1b[1m',
    reset: '\x1b[0m'
};

/**
 * Formats translated errors for different output targets
 */
export class ShaderErrorFormatter {
    private options: FormatOptions;

    constructor(options: Partial<FormatOptions> = {}) {
        this.options = { ...DEFAULT_FORMAT_OPTIONS, ...options };
    }

    /**
     * Format complete diagnostics for console output
     */
    formatConsole(diagnostics: ShaderDiagnostics): string {
        const parts: string[] = [];

        // Header
        if (!diagnostics.success) {
            const icon = this.colorize('❌', 'red');
            const count = diagnostics.stats.totalErrors;
            parts.push(`${icon} Shader compilation failed with ${count} error(s)\n`);
        }

        // Errors
        for (const error of diagnostics.errors) {
            parts.push(this.formatError(error));
            parts.push(''); // Blank line between errors
        }

        // Warnings
        for (const warning of diagnostics.warnings) {
            parts.push(this.formatError(warning));
            parts.push('');
        }

        // Summary
        parts.push(this.formatSummary(diagnostics));

        return parts.join('\n');
    }

    /**
     * Format single error for console
     */
    formatError(error: TranslatedError): string {
        const parts: string[] = [];

        // Separator
        parts.push(this.colorize('━'.repeat(70), 'gray'));

        // Header with icon and message
        const icon = error.severity === 'error'
            ? this.colorize('❌', 'red')
            : this.colorize('⚠️ ', 'yellow');

        const categoryLabel = this.formatCategory(error.category);
        parts.push(`${icon} ${this.colorize(categoryLabel, 'bold')}: ${error.message}`);
        parts.push('');

        // Module context
        if (error.requiredBy) {
            parts.push(`Required by: ${this.colorize(error.requiredBy, 'blue')}`);
        }
        if (error.expectedProvider) {
            parts.push(`Expected provider: ${this.colorize(error.expectedProvider, 'blue')}`);
        }
        if (error.requiredBy || error.expectedProvider) {
            parts.push('');
        }

        // Locations
        if (error.locations.length > 0) {
            if (this.options.showAllOccurrences && error.locations.length > 1) {
                parts.push(`Called in ${error.locations.length} places:`);
                for (const loc of error.locations) {
                    parts.push(`  • Line ${loc.moduleLineNumber} in ${loc.moduleKind} module '${loc.module}'`);
                }
                parts.push('');
            } else {
                const loc = error.locations[0];
                if (error.locations.length > 1) {
                    parts.push(`First occurrence (of ${error.locations.length}):`);
                }
                parts.push(`Location: Line ${loc.moduleLineNumber} in ${loc.moduleKind} module '${loc.module}'`);
                parts.push('');
            }
        }

        // Suggestion
        if (error.suggestion) {
            parts.push(this.colorize('💡 Suggestion:', 'green'));
            parts.push(`   ${error.suggestion}`);
            parts.push('');
        }

        // Detail
        if (error.detail) {
            parts.push(this.colorize('Details:', 'gray'));
            parts.push(`   ${error.detail}`);
            parts.push('');
        }

        // Alternatives
        if (error.alternatives && error.alternatives.length > 0) {
            parts.push(this.colorize('Available functions:', 'gray'));
            for (const alt of error.alternatives.slice(0, 5)) {
                parts.push(`   • ${alt}`);
            }
            if (error.alternatives.length > 5) {
                parts.push(`   ... and ${error.alternatives.length - 5} more`);
            }
            parts.push('');
        }

        // Context (source code)
        if (this.options.showContext && error.locations.length > 0) {
            parts.push(this.colorize('Source context:', 'gray'));
            parts.push(error.locations[0].context);
            parts.push('');
        }

        return parts.join('\n');
    }

    /**
     * Format diagnostics summary
     */
    formatSummary(diagnostics: ShaderDiagnostics): string {
        const parts: string[] = [];
        const stats = diagnostics.stats;

        parts.push(this.colorize('═'.repeat(70), 'gray'));
        parts.push(this.colorize('Summary:', 'bold'));

        if (stats.totalErrors > 0) {
            parts.push(`  ${this.colorize('Errors:', 'red')} ${stats.totalErrors}`);
            if (stats.missingFunctions > 0) {
                parts.push(`    - Missing functions: ${stats.missingFunctions}`);
            }
            if (stats.typeMismatches > 0) {
                parts.push(`    - Type mismatches: ${stats.typeMismatches}`);
            }
            if (stats.syntaxErrors > 0) {
                parts.push(`    - Syntax errors: ${stats.syntaxErrors}`);
            }
            if (stats.linkerErrors > 0) {
                parts.push(`    - Linker errors: ${stats.linkerErrors}`);
            }
        }

        if (stats.totalWarnings > 0) {
            parts.push(`  ${this.colorize('Warnings:', 'yellow')} ${stats.totalWarnings}`);
        }

        if (diagnostics.success) {
            parts.push(this.colorize('✓ Compilation successful', 'green'));
        }

        return parts.join('\n');
    }

    /**
     * Format category name for display
     */
    private formatCategory(category: string): string {
        return category.split('_').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }

    /**
     * Apply ANSI color codes if options.useColors is true
     */
    private colorize(text: string, color: keyof typeof COLORS): string {
        if (!this.options.useColors) {
            return text;
        }
        return `${COLORS[color]}${text}${COLORS.reset}`;
    }
}
