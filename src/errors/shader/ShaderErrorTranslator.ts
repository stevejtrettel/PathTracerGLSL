import type { GLSLError, LineMap, TranslatedError } from '../types.js';
import type { ModuleDescriptor } from '../../engine/types.js';
import { ShaderErrorParser } from './ShaderErrorParser.js';
import { extractFunctionDeclarations } from './utils/function-extraction.js';
import { findClosestMatch } from './utils/typo-detection.js';
import { PREFIX_MODULE_MAP } from './types.js';

/**
 * Translates raw GLSL errors into helpful, context-aware messages
 */
export class ShaderErrorTranslator {
    private modules: ModuleDescriptor[];
    private source: string;
    private lineMap: LineMap;
    private parser: ShaderErrorParser;
    private functionCache: Map<string, string[]>;

    constructor(modules: ModuleDescriptor[], source: string) {
        this.modules = modules;
        this.source = source;
        this.parser = new ShaderErrorParser();
        this.lineMap = this.parser.buildLineMap(source, modules);
        this.functionCache = new Map();
    }

    /**
     * Translate array of GLSL errors into enhanced errors
     *
     * Process:
     * 1. Categorize each error
     * 2. Add module context
     * 3. Generate suggestions
     * 4. Deduplicate
     */
    translate(glslErrors: GLSLError[]): TranslatedError[] {
        const translated: TranslatedError[] = [];

        for (const error of glslErrors) {
            const translatedError = this.translateSingle(error);
            if (translatedError) {
                translated.push(translatedError);
            }
        }

        return this.deduplicate(translated);
    }

    /**
     * Translate a single GLSL error
     */
    private translateSingle(error: GLSLError): TranslatedError | null {
        // Determine error category
        if (this.isMissingFunction(error)) {
            return this.translateMissingFunction(error);
        } else if (this.isUniformError(error)) {
            return this.translateUniformError(error);
        } else if (this.isTypeMismatch(error)) {
            return this.translateTypeMismatch(error);
        } else if (this.isSyntaxError(error)) {
            return this.translateSyntaxError(error);
        } else {
            return this.translateGeneric(error);
        }
    }

    /**
     * Check if error is a missing function
     * Patterns:
     * - "'function_name' : no matching overloaded function found"
     * - "undeclared identifier 'function_name'"
     * - "'return' : function return is not matching type" (indirect - missing function)
     */
    private isMissingFunction(error: GLSLError): boolean {
        return /no matching overloaded function found|undeclared identifier|undefined|function return is not matching type/i.test(error.message);
    }

    /**
     * Check if error is a type mismatch
     * Pattern: "wrong operand types" or "cannot convert"
     */
    private isTypeMismatch(error: GLSLError): boolean {
        return /wrong operand|cannot convert|type mismatch|incompatible types/i.test(error.message);
    }

    /**
     * Check if error is a syntax error
     * Pattern: "syntax error" or "unexpected token"
     */
    private isSyntaxError(error: GLSLError): boolean {
        return /syntax error|unexpected|expected/i.test(error.message);
    }

    /**
     * Check if error is a uniform error
     * Pattern: undeclared uniform, uniform not found
     */
    private isUniformError(error: GLSLError): boolean {
        return /undeclared.*uniform|uniform.*not (found|declared)/i.test(error.message);
    }

    /**
     * Translate missing function error with suggestions
     */
    private translateMissingFunction(error: GLSLError): TranslatedError {
        const location = this.parser.lineToLocation(error.line, this.lineMap, this.source);
        const functionName = this.extractFunctionName(error.message, error.line);

        if (!functionName) {
            return this.translateGeneric(error);
        }

        const prefix = this.extractPrefix(functionName);
        const expectedProvider = prefix ? PREFIX_MODULE_MAP[prefix] : null;

        // Find the module that provides this prefix
        const providerModule = expectedProvider
            ? this.modules.find(m => m.id.kind === expectedProvider)
            : null;

        // Get available functions from provider module
        const availableFunctions = providerModule
            ? this.getAvailableFunctions(providerModule)
            : [];

        // Find similar functions (typo detection)
        const closest = findClosestMatch(functionName, availableFunctions, 3);

        const requiredBy = location
            ? `${location.moduleKind} module '${location.module}'`
            : 'unknown module';

        const expectedProviderStr = providerModule
            ? `${providerModule.id.kind} module '${providerModule.id.name}'`
            : expectedProvider || 'unknown module';

        return {
            severity: error.type,
            category: 'missing_function',
            message: `Function '${functionName}' not found`,
            detail: closest
                ? `Did you mean '${closest.match}'?`
                : providerModule && availableFunctions.length > 0
                    ? `Available functions in ${expectedProviderStr}: ${availableFunctions.slice(0, 5).join(', ')}`
                    : undefined,
            functionName,
            requiredBy,
            expectedProvider: expectedProviderStr,
            locations: location ? [location] : [],
            suggestion: closest
                ? `Did you mean '${closest.match}'? (distance: ${closest.distance})`
                : undefined,
            alternatives: availableFunctions.slice(0, 10),
            originalError: error
        };
    }

    /**
     * Translate type mismatch error
     */
    private translateTypeMismatch(error: GLSLError): TranslatedError {
        const location = this.parser.lineToLocation(error.line, this.lineMap, this.source);

        return {
            severity: error.type,
            category: 'type_mismatch',
            message: 'Type mismatch',
            detail: error.message,
            locations: location ? [location] : [],
            originalError: error
        };
    }

    /**
     * Translate syntax error
     */
    private translateSyntaxError(error: GLSLError): TranslatedError {
        const location = this.parser.lineToLocation(error.line, this.lineMap, this.source);

        return {
            severity: error.type,
            category: 'syntax',
            message: 'Syntax error',
            detail: error.message,
            locations: location ? [location] : [],
            originalError: error
        };
    }

    /**
     * Translate uniform binding error
     */
    private translateUniformError(error: GLSLError): TranslatedError {
        const location = this.parser.lineToLocation(error.line, this.lineMap, this.source);

        // Try to extract uniform name from error
        const uniformMatch = /'(u_\w+)'/.exec(error.message);
        const uniformName = uniformMatch ? uniformMatch[1] : null;

        return {
            severity: error.type,
            category: 'uniform_error',
            message: uniformName ? `Uniform '${uniformName}' not found` : 'Uniform error',
            detail: uniformName
                ? `The uniform '${uniformName}' is used but not declared. Check module uniformBindings or shader uniforms.`
                : error.message,
            locations: location ? [location] : [],
            originalError: error
        };
    }

    /**
     * Generic translation for unrecognized errors
     */
    private translateGeneric(error: GLSLError): TranslatedError {
        const location = this.parser.lineToLocation(error.line, this.lineMap, this.source);

        return {
            severity: error.type,
            category: 'other',
            message: error.message,
            locations: location ? [location] : [],
            originalError: error
        };
    }

    /**
     * Deduplicate errors - same error at multiple locations
     *
     * Strategy:
     * 1. Group errors by (category, functionName, message)
     * 2. Aggregate locations
     * 3. Keep first context, list all line numbers
     */
    private deduplicate(errors: TranslatedError[]): TranslatedError[] {
        const grouped = new Map<string, TranslatedError>();

        for (const error of errors) {
            const key = this.makeDeduplicationKey(error);
            const existing = grouped.get(key);

            if (existing) {
                // Merge locations
                existing.locations.push(...error.locations);
            } else {
                grouped.set(key, error);
            }
        }

        return Array.from(grouped.values());
    }

    /**
     * Create grouping key for deduplication
     */
    private makeDeduplicationKey(error: TranslatedError): string {
        const parts = [error.category, error.functionName || '', error.message];
        return parts.join(':');
    }

    /**
     * Extract function name from error message or source context
     * Handles:
     * - "'function_name' : ..."
     * - "undefined identifier `function_name`"
     * - Extracts from source when error is indirect (e.g., return type mismatch)
     */
    private extractFunctionName(message: string, line: number): string | null {
        // Try to extract from error message first
        // Pattern 1: 'functionName'
        const match1 = /'(\w+)'/.exec(message);
        if (match1 && match1[1] !== 'return') {  // Ignore generic keywords
            return match1[1];
        }

        // Pattern 2: `functionName`
        const match2 = /`(\w+)`/.exec(message);
        if (match2) {
            return match2[1];
        }

        // Pattern 3: Extract from source code at error line
        // This handles "function return is not matching type" errors
        const sourceLines = this.source.split('\n');
        if (line > 0 && line <= sourceLines.length) {
            const sourceLine = sourceLines[line - 1];

            // Match function calls: functionName(
            const callMatch = /(\w+_\w+)\s*\(/g.exec(sourceLine);
            if (callMatch) {
                return callMatch[1];
            }
        }

        return null;
    }

    /**
     * Extract module prefix from function name
     * E.g., "camera_generateRay" → "camera"
     */
    private extractPrefix(functionName: string): string | null {
        const underscoreIndex = functionName.indexOf('_');
        if (underscoreIndex > 0) {
            return functionName.substring(0, underscoreIndex);
        }
        return null;
    }

    /**
     * Get available functions from a module
     * Auto-extracts from GLSL source and caches
     */
    private getAvailableFunctions(module: ModuleDescriptor): string[] {
        const key = `${module.id.kind}:${module.id.name}`;

        if (!this.functionCache.has(key)) {
            const functions = extractFunctionDeclarations(module.fragment.functions);
            this.functionCache.set(key, functions);
        }

        return this.functionCache.get(key)!;
    }
}
