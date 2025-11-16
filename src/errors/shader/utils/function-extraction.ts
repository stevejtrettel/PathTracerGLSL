/**
 * Extract all function declarations from GLSL source code
 * Handles multi-line declarations and avoids functions in comments
 *
 * @param source - GLSL source code
 * @param prefix - Optional prefix to filter by (e.g., 'camera')
 * @returns Array of function names
 */
export function extractFunctionDeclarations(
    source: string,
    prefix?: string
): string[] {
    // Remove single-line comments
    const withoutLineComments = source.replace(/\/\/.*$/gm, '');

    // Remove multi-line comments
    const withoutComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '');

    // Regex to match function declarations
    // Matches: returnType functionName(
    // Where functionName optionally starts with prefix_
    const prefixPattern = prefix ? `${prefix}_` : '';
    const functionRegex = new RegExp(
        `\\b(?:void|bool|int|uint|float|vec2|vec3|vec4|mat2|mat3|mat4|[a-zA-Z_]\\w*)\\s+(${prefixPattern}\\w+)\\s*\\(`,
        'g'
    );

    const functions = new Set<string>();
    let match;

    while ((match = functionRegex.exec(withoutComments)) !== null) {
        const functionName = match[1];
        // Filter by prefix if specified
        if (!prefix || functionName.startsWith(prefix + '_')) {
            functions.add(functionName);
        }
    }

    return Array.from(functions);
}

/**
 * Extract function signature (for future type checking)
 *
 * @param source - GLSL source code
 * @param functionName - Function to find
 * @returns Function signature or null
 */
export function extractFunctionSignature(
    source: string,
    functionName: string
): {
    returnType: string;
    name: string;
    parameters: Array<{ type: string; name: string }>;
} | null {
    // Remove comments
    const withoutLineComments = source.replace(/\/\/.*$/gm, '');
    const withoutComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '');

    // Regex to find the function declaration
    // This is a simplified version - full GLSL parsing is complex
    const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const signatureRegex = new RegExp(
        `(\\w+)\\s+${escapedName}\\s*\\(([^)]*)\\)`,
        's'
    );

    const match = signatureRegex.exec(withoutComments);
    if (!match) {
        return null;
    }

    const returnType = match[1];
    const paramsString = match[2];

    // Parse parameters
    const parameters: Array<{ type: string; name: string }> = [];
    if (paramsString.trim()) {
        const paramParts = paramsString.split(',');
        for (const part of paramParts) {
            const trimmed = part.trim();
            // Match: type name or type name[]
            const paramMatch = /^(\w+(?:\[\])?)\s+(\w+)/.exec(trimmed);
            if (paramMatch) {
                parameters.push({
                    type: paramMatch[1],
                    name: paramMatch[2]
                });
            }
        }
    }

    return {
        returnType,
        name: functionName,
        parameters
    };
}

/**
 * Extract all function calls from GLSL source (functions being called, not defined)
 * Useful for finding what functions a module depends on
 *
 * @param source - GLSL source code
 * @param prefix - Optional prefix to filter by
 * @returns Array of function names being called
 */
export function extractFunctionCalls(
    source: string,
    prefix?: string
): string[] {
    // Remove comments
    const withoutLineComments = source.replace(/\/\/.*$/gm, '');
    const withoutComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '');

    // Regex to match function calls
    // Matches: functionName(
    const prefixPattern = prefix ? `${prefix}_` : '';
    const callRegex = new RegExp(
        `\\b(${prefixPattern}\\w+)\\s*\\(`,
        'g'
    );

    const calls = new Set<string>();
    let match;

    while ((match = callRegex.exec(withoutComments)) !== null) {
        const functionName = match[1];
        // Filter by prefix if specified
        if (!prefix || functionName.startsWith(prefix + '_')) {
            calls.add(functionName);
        }
    }

    return Array.from(calls);
}
