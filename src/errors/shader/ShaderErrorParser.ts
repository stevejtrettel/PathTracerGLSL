import type { GLSLError, LineMap, SourceLocation } from '../types.js';
import type { ModuleDescriptor } from '../../infrastructure/engine/types.js';

/**
 * Parses raw GLSL compiler output into structured errors
 * and maps line numbers back to source modules
 */
export class ShaderErrorParser {
    /**
     * Parse GLSL compiler error log into structured errors
     *
     * GLSL error format varies by implementation but typically:
     * - "ERROR: 0:123: message"
     * - "WARNING: 0:45: message"
     * - "ERROR: 0:123: 'identifier' : specific error details"
     *
     * @param errorLog - Raw error string from gl.getShaderInfoLog() or gl.getProgramInfoLog()
     * @returns Array of structured errors
     */
    parse(errorLog: string): GLSLError[] {
        const errors: GLSLError[] = [];
        const lines = errorLog.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Try multiple error formats
            const parsed = this.parseLine(trimmed);
            if (parsed) {
                errors.push(parsed);
            }
        }

        return errors;
    }

    /**
     * Parse a single error line
     * Supports multiple GLSL error formats
     */
    private parseLine(line: string): GLSLError | null {
        // Format 1: "ERROR: 0:123: message" (most common)
        const format1 = /^(ERROR|WARNING):\s*\d+:(\d+):\s*(.+)$/i.exec(line);
        if (format1) {
            return {
                type: format1[1].toLowerCase() as 'error' | 'warning',
                line: parseInt(format1[2], 10),
                message: format1[3].trim(),
                raw: line
            };
        }

        // Format 2: "0(123) : error C1234: message" (NVIDIA-style)
        const format2 = /^\d+\((\d+)\)\s*:\s*(error|warning)\s*.*?:\s*(.+)$/i.exec(line);
        if (format2) {
            return {
                type: format2[2].toLowerCase() as 'error' | 'warning',
                line: parseInt(format2[1], 10),
                message: format2[3].trim(),
                raw: line
            };
        }

        // Format 3: "ERROR: program_name:123: message" (some drivers)
        const format3 = /^(ERROR|WARNING):\s*[\w_]+:(\d+):\s*(.+)$/i.exec(line);
        if (format3) {
            return {
                type: format3[1].toLowerCase() as 'error' | 'warning',
                line: parseInt(format3[2], 10),
                message: format3[3].trim(),
                raw: line
            };
        }

        // Unable to parse - might be continuation line or different format
        return null;
    }

    /**
     * Build a map from concatenated shader line numbers to module locations
     *
     * Strategy:
     * 1. Look for module boundary comments: "// ============ moduleName (kind) ============"
     * 2. Track which lines belong to which module
     * 3. Handle edge cases (header, RNG system, main function)
     *
     * @param source - Full concatenated shader source
     * @param modules - Array of module descriptors in compilation order
     * @returns Map from line number to module location info
     */
    buildLineMap(source: string, modules: ModuleDescriptor[]): LineMap {
        const lineMap: LineMap = {};
        const lines = source.split('\n');

        let currentModule: ModuleDescriptor | null = null;
        let moduleStartLine = 0;

        for (let i = 0; i < lines.length; i++) {
            const lineNumber = i + 1; // Lines are 1-indexed
            const line = lines[i];

            // Check for module boundary comment
            // Format: // ============ moduleName (moduleKind) ============
            const moduleMatch = /^\/\/\s*=+\s*(\w+)\s*\((\w+)\)\s*=+/.exec(line);

            if (moduleMatch) {
                const moduleName = moduleMatch[1];
                const moduleKind = moduleMatch[2];

                // Find the corresponding module
                const module = modules.find(
                    m => m.id.name === moduleName && m.id.kind === moduleKind
                );

                if (module) {
                    currentModule = module;
                    moduleStartLine = lineNumber;
                }
                continue;
            }

            // Check for system section headers
            // Format: // ============ SECTION_NAME ============
            const systemMatch = /^\/\/\s*=+\s*([A-Z_\s]+)\s*=+/.exec(line);
            if (systemMatch) {
                // System section - not part of a module
                currentModule = null;
                continue;
            }

            // Map this line to current module (or null for system lines)
            if (currentModule) {
                lineMap[lineNumber] = {
                    module: currentModule,
                    moduleStartLine,
                    moduleEndLine: lineNumber // Will be updated as we progress
                };

                // Update all lines in this module to have correct end line
                for (let j = moduleStartLine; j <= lineNumber; j++) {
                    if (lineMap[j] && lineMap[j]!.module === currentModule) {
                        lineMap[j]!.moduleEndLine = lineNumber;
                    }
                }
            } else {
                lineMap[lineNumber] = null;
            }
        }

        return lineMap;
    }

    /**
     * Get source code context around a line
     *
     * @param source - Full source code
     * @param line - Target line number (1-indexed)
     * @param contextLines - Number of lines before/after to include (default: 2)
     * @returns Formatted context string with line numbers
     */
    getContext(source: string, line: number, contextLines: number = 2): string {
        const lines = source.split('\n');
        const startLine = Math.max(1, line - contextLines);
        const endLine = Math.min(lines.length, line + contextLines);

        const contextParts: string[] = [];

        for (let i = startLine; i <= endLine; i++) {
            const isErrorLine = i === line;
            const lineContent = lines[i - 1] || '';
            const lineNum = i.toString().padStart(4, ' ');

            if (isErrorLine) {
                contextParts.push(`> ${lineNum}: ${lineContent}`);
            } else {
                contextParts.push(`  ${lineNum}: ${lineContent}`);
            }
        }

        return contextParts.join('\n');
    }

    /**
     * Convert line number to module location
     *
     * @param line - Line number in concatenated shader
     * @param lineMap - Line map from buildLineMap()
     * @param source - Full shader source (for context)
     * @returns Module location or null if not in any module
     */
    lineToLocation(line: number, lineMap: LineMap, source: string): SourceLocation | null {
        const entry = lineMap[line];
        if (!entry) {
            return null;
        }

        const moduleLineNumber = line - entry.moduleStartLine + 1;

        return {
            line,
            module: entry.module.id.name,
            moduleKind: entry.module.id.kind,
            moduleLineNumber,
            context: this.getContext(source, line)
        };
    }
}
