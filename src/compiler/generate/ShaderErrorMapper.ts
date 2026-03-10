// compiler/generate/ShaderErrorMapper.ts

import type { SourceMap } from '../types.js';
import { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import { lookupLine } from './ShaderIR.js';
import type { BlockMapping } from './ShaderIR.js';

// Standard GLSL error format: ERROR: 0:142: 'foo' : undeclared identifier
// Some drivers also emit: WARNING: 0:42: ...
const GLSL_ERROR_RE = /^(ERROR|WARNING):\s*\d+:(\d+):\s*(.+)$/;

interface ParsedGLSLError {
    severity: 'error' | 'warning';
    line: number;
    message: string;
}

/**
 * Parse a single line from gl.getShaderInfoLog()
 */
function parseGLSLErrorLine(line: string): ParsedGLSLError | null {
    const match = line.match(GLSL_ERROR_RE);
    if (!match) return null;

    return {
        severity: match[1] === 'WARNING' ? 'warning' : 'error',
        line: parseInt(match[2], 10),
        message: match[3],
    };
}

/**
 * Map shader compilation errors through a source map to produce Diagnostics.
 *
 * @param infoLog - Raw output from gl.getShaderInfoLog()
 * @param shaderId - The shader that failed
 * @param blockMap - Block mappings from ShaderIR assembleBlocks
 * @param assembledSource - Optional full GLSL source for context snippets
 * @returns DiagnosticBag with mapped errors
 */
export function mapShaderErrors(
    infoLog: string,
    shaderId: string,
    blockMap: BlockMapping[],
    assembledSource?: string,
): DiagnosticBag {
    const bag = new DiagnosticBag();
    const logLines = infoLog.split('\n').filter(l => l.trim().length > 0);

    for (const line of logLines) {
        const parsed = parseGLSLErrorLine(line);

        if (!parsed) {
            // Skip lines that don't match GLSL error format (e.g. blank lines, driver info)
            continue;
        }

        const lookup = lookupLine(blockMap, parsed.line);
        const builder = parsed.severity === 'error'
            ? bag.error('shader-compile-error', parsed.message)
            : bag.warning('shader-compile-error', parsed.message);

        if (lookup) {
            builder
                .atLine(shaderId, parsed.line)
                .withOriginal(lookup.origin, [`line:${lookup.localLine}`]);
        } else {
            builder.atLine(shaderId, parsed.line);
        }

        // Attach full assembled source for context display
        // ConsoleReporter indexes by absolute line number, so it needs the full source
        if (assembledSource) {
            builder.withSourceText(assembledSource);
        }

        builder.add();
    }

    return bag;
}

/**
 * Parse shader errors from Engine's error message format.
 *
 * The Engine throws errors like:
 *   "Shader compilation failed (pathtracer-main-main): ERROR: 0:142: ..."
 *
 * @param errorMessage - The error.message from Engine
 * @param sourceMaps - Map of shaderId → SourceMap from CompiledRenderer
 * @returns DiagnosticBag with mapped errors, or null if format doesn't match
 */
export function mapEngineShaderError(
    errorMessage: string,
    sourceMaps: Map<string, SourceMap>,
): DiagnosticBag | null {
    // Match: "Shader compilation failed (shaderId): <log>"
    const match = errorMessage.match(/Shader compilation failed \(([^)]+)\):\s*([\s\S]+)/);
    if (!match) return null;

    const rawShaderId = match[1];
    const infoLog = match[2];

    // Engine appends " fragment" or " vertex" to the shader ID — strip it for source map lookup
    const shaderId = rawShaderId.replace(/\s+(fragment|vertex)$/, '');

    const sourceMap = sourceMaps.get(shaderId);
    if (!sourceMap) {
        // Shader ID not in our source maps — return unmapped errors
        const bag = new DiagnosticBag();
        bag.error('shader-compile-error', `${rawShaderId}: ${infoLog}`).add();
        return bag;
    }

    return mapShaderErrors(infoLog, shaderId, sourceMap.blocks, sourceMap.assembledSource);
}
