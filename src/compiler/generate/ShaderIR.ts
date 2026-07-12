// compiler/generate/ShaderIR.ts
// Block-level intermediate representation for shader assembly.
// Tracks provenance of each GLSL section for source map generation.

/**
 * A tagged block of GLSL source with provenance.
 */
export interface ShaderBlock {
    /** Origin label: 'glsl/core/structs.glsl' or 'generated:sdf-dispatch' */
    origin: string;
    /** The GLSL source text */
    source: string;
}

/**
 * A line range in the assembled shader mapped to its source block.
 */
export interface BlockMapping {
    origin: string;
    /** First line in assembled output (1-based) */
    startLine: number;
    /** Last line in assembled output (1-based, inclusive) */
    endLine: number;
}

/**
 * Result of assembling ShaderBlocks into final GLSL.
 */
export interface AssembledShader {
    source: string;
    blockMap: BlockMapping[];
}

/**
 * Assemble an array of ShaderBlocks into final GLSL with a block-level source map.
 *
 * Blocks are joined with '\n'. The join separator acts as the newline
 * ending the previous block's last line, so currentLine advances by
 * lineCount with no extra increment.
 */
export function assembleBlocks(blocks: ShaderBlock[]): AssembledShader {
    const blockMap: BlockMapping[] = [];
    let currentLine = 1;

    for (const block of blocks) {
        const lineCount = countLines(block.source);
        blockMap.push({
            origin: block.origin,
            startLine: currentLine,
            endLine: currentLine + lineCount - 1,
        });
        currentLine += lineCount;
    }

    return {
        source: blocks.map(b => b.source).join('\n'),
        blockMap,
    };
}

/**
 * Given a line number in assembled GLSL, find which block it belongs to
 * and the local line within that block.
 */
export function lookupLine(blockMap: BlockMapping[], assembledLine: number): {
    origin: string;
    localLine: number;
} | null {
    for (const mapping of blockMap) {
        if (assembledLine >= mapping.startLine && assembledLine <= mapping.endLine) {
            return {
                origin: mapping.origin,
                localLine: assembledLine - mapping.startLine + 1,
            };
        }
    }
    return null;
}

function countLines(s: string): number {
    if (s.length === 0) return 1;
    let count = 1;
    for (let i = 0; i < s.length; i++) {
        if (s.charCodeAt(i) === 10) count++;
    }
    return count;
}
