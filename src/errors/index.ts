// Re-export types
export * from './types.js';
export * from './shader/types.js';

// Re-export shader error classes
export { ShaderErrorParser } from './shader/ShaderErrorParser.js';
export { ShaderErrorTranslator } from './shader/ShaderErrorTranslator.js';
export { ShaderErrorFormatter } from './shader/ShaderErrorFormatter.js';

// Re-export shader utilities
export * from './shader/utils/function-extraction.js';
export * from './shader/utils/typo-detection.js';

// Re-export engine validation
export { validateRecipe, validateModuleUniforms, validateRecipeModules } from './engine/validation.js';

// Re-export resource validation
export {
    validateHDRResponse,
    validateHDRBuffer,
    validateHDRData,
    validateTextureCreation,
    validateHDRLoad
} from './resources/validation.js';

import type { ShaderDiagnostics, FormatOptions } from './types.js';
import type { ModuleDescriptor } from '../infrastructure/engine/types.js';
import { ShaderErrorParser } from './shader/ShaderErrorParser.js';
import { ShaderErrorTranslator } from './shader/ShaderErrorTranslator.js';
import { ShaderErrorFormatter } from './shader/ShaderErrorFormatter.js';

/**
 * Convenience function: Complete error translation pipeline
 *
 * This is the main entry point most code will use.
 *
 * @param errorLog - Raw GLSL compiler error string
 * @param source - Full concatenated shader source
 * @param modules - Array of module descriptors
 * @returns Complete diagnostics
 */
export function translateShaderErrors(
    errorLog: string,
    source: string,
    modules: ModuleDescriptor[]
): ShaderDiagnostics {
    // 1. Parse raw errors
    const parser = new ShaderErrorParser();
    const glslErrors = parser.parse(errorLog);

    // 2. Translate
    const translator = new ShaderErrorTranslator(modules, source);
    const translated = translator.translate(glslErrors);

    // 3. Separate errors and warnings
    const errors = translated.filter(e => e.severity === 'error');
    const warnings = translated.filter(e => e.severity === 'warning');

    // 4. Calculate statistics
    const stats = {
        totalErrors: errors.length,
        totalWarnings: warnings.length,
        missingFunctions: errors.filter(e => e.category === 'missing_function').length,
        typeMismatches: errors.filter(e => e.category === 'type_mismatch').length,
        syntaxErrors: errors.filter(e => e.category === 'syntax').length,
        linkerErrors: errors.filter(e => e.category === 'linker_error').length,
        other: errors.filter(e => e.category === 'other').length
    };

    // 5. Generate source with line numbers
    const sourceWithLineNumbers = addLineNumbers(source);

    return {
        success: errors.length === 0,
        errors,
        warnings,
        source,
        sourceWithLineNumbers,
        modules,
        stats
    };
}

/**
 * Convenience function: Parse and format in one call
 *
 * @param errorLog - Raw GLSL error string
 * @param source - Full shader source
 * @param modules - Module descriptors
 * @param options - Format options
 * @returns Formatted string for console output
 */
export function formatShaderErrors(
    errorLog: string,
    source: string,
    modules: ModuleDescriptor[],
    options?: Partial<FormatOptions>
): string {
    const diagnostics = translateShaderErrors(errorLog, source, modules);
    const formatter = new ShaderErrorFormatter(options);
    return formatter.formatConsole(diagnostics);
}

/**
 * Add line numbers to source code
 */
function addLineNumbers(source: string): string {
    const lines = source.split('\n');
    const maxLineNumWidth = lines.length.toString().length;

    return lines
        .map((line, index) => {
            const lineNum = (index + 1).toString().padStart(maxLineNumWidth, ' ');
            return `${lineNum} | ${line}`;
        })
        .join('\n');
}
