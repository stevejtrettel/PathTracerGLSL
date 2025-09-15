// src/engine/shaders/namespacing.ts
/**
 * namespacing.ts — v1
 * ------------------------------------------------------------
 * PURPOSE
 *   Provide deterministic, collision-free namespacing for module-local GLSL
 *   identifiers (uniforms and private helpers) during static assembly.
 *   Public symbols used for linking (listed in `provides`/`requires`) remain
 *   unmodified so the linker can resolve them by name.
 *
 * INPUTS
 *   - ComponentID-derived namespace seed for each module.
 *   - Raw fragment text sections: `uniforms`, `functions`, optional `mainCode`.
 *   - A list of public symbol names that MUST NOT be renamed.
 *
 * OUTPUTS
 *   - Namespaced fragment sections with all private identifiers safely prefixed.
 *   - A per-module mapping table of original uniform names → namespaced names.
 *
 * INVARIANTS
 *   - Public symbol names in `provides`/`requires` are preserved exactly.
 *   - Private identifiers (uniforms, local functions) are prefixed with a
 *     stable, human-readable token derived from the module’s ComponentID.
 *   - Namespacing is textual but identifier-aware (does not rename inside
 *     comments, string literals, or other identifiers).
 *
 * SCOPE & NON-GOALS
 *   - No semantic parsing of GLSL beyond token/identifier boundaries.
 *   - No minification/obfuscation; aim for readability in diagnostics.
 *
 * ERROR HANDLING
 *   - If the same uniform name appears twice within one module scope, throw
 *     a clear error (module-level duplication).
 *
 * TESTING GUIDANCE
 *   - Private helper `foo` and uniform `exposure` get prefixed (e.g., `mA1_foo`,
 *     `mA1_exposure`), while public `shadePixel` remains unchanged.
 *   - Identifiers inside comments/strings are not altered.
 *   - Two distinct modules producing the same local uniform do not collide
 *     after namespacing (different prefixes).
 *
 * EVOLUTION NOTES
 *   - v1.1 may add configurable prefix styles or length.
 *   - v2 may switch to AST-backed renaming if we adopt a GLSL parser.
 */

import type { ShaderModuleDescriptor } from "../../core/shader-fragment";
import type { ComponentID } from "../../core/ids";
import { hashComponentID } from "../../core/ids";

export interface UniformMappingEntry {
    logicalName: string;
    namespacedName: string;
    /** Optional parsed type if we could extract it (e.g., "float", "vec3", "sampler2D") */
    type?: string;
}

export interface ModuleNamespaceResult {
    uniforms: string;
    functions: string;
    mainCode: string;
    /** Per-uniform logical → namespaced entries for manifest merging. */
    uniformMappings: ReadonlyArray<UniformMappingEntry>;
    /** Private helper function renames (original → namespaced). */
    helperMappings: Readonly<Record<string, string>>;
    /** Prefix used (e.g., "mA1b2c3_") for diagnostics. */
    namespacePrefix: string;
}

export interface NamespacingOptions {
    /** Public symbols (from provides/requires) that must NOT be renamed. */
    readonly preserve: readonly string[];
}

/** Build a stable, human-readable prefix from a ComponentID. */
export function makeModulePrefix(id: ComponentID, size: number = 6): string {
    const h = hashComponentID(id).slice(0, Math.max(1, size));
    return `m${h}_`;
}

/**
 * Main entry: namespace a module’s fragment.
 * - Prefix all declared uniforms.
 * - Prefix private helper functions (functions we can detect that are NOT in preserve).
 * - Replace references in `functions` and `mainCode`, but never rename `preserve` symbols.
 */
export function namespaceModule(
    mod: ShaderModuleDescriptor,
    opts: NamespacingOptions
): ModuleNamespaceResult {
    const preserve = new Set(opts.preserve ?? []);
    const prefix = makeModulePrefix(mod.id);

    // Step 1: parse uniform declarations into mapping
    const uniformDecl = mod.fragment.uniforms ?? "";
    const uniformEntries = extractUniforms(uniformDecl);
    // detect duplicates in the same module
    const seenUniform = new Set<string>();
    for (const u of uniformEntries) {
        if (seenUniform.has(u.name)) {
            throw new Error(
                `Namespacing: duplicate uniform "${u.name}" in ${mod.id.kind}/${mod.id.name}@${mod.id.version}`
            );
        }
        seenUniform.add(u.name);
    }
    const uniformMap = Object.fromEntries(
        uniformEntries.map((u) => [u.name, prefix + u.name])
    );

    // Step 2: detect helper function definitions (not in preserve)
    const fnNames = extractFunctionNames((mod.fragment.functions ?? "") + "\n" + (mod.fragment.mainCode ?? ""));
    const helperNames = fnNames.filter((n) => !preserve.has(n));
    const helperMap = Object.fromEntries(helperNames.map((n) => [n, prefix + n]));

    // Step 3: rewrite sections
    const uniformsOut = replaceIds(uniformDecl, uniformMap, preserve);
    // Replace both uniforms and helper names in code sections
    const replaceMap = { ...uniformMap, ...helperMap };
    const functionsOut = replaceIds(mod.fragment.functions ?? "", replaceMap, preserve);
    const mainOut = replaceIds(mod.fragment.mainCode ?? "", replaceMap, preserve);

    const uniformMappings: UniformMappingEntry[] = uniformEntries.map((u) => ({
        logicalName: u.name,
        namespacedName: uniformMap[u.name],
        type: u.type,
    }));

    return {
        uniforms: uniformsOut,
        functions: functionsOut,
        mainCode: mainOut,
        uniformMappings,
        helperMappings: helperMap,
        namespacePrefix: prefix,
    };
}

/**
 * Extract uniform declarations from a `uniforms` section.
 * Supports comma-separated names, array declarators, and basic types.
 * Examples handled:
 *   uniform float exposure;
 *   uniform vec3 albedo, emission;
 *   uniform sampler2D tex0, tex1;
 *   uniform float weights[4];
 */
export function extractUniforms(src: string): ReadonlyArray<{ name: string; type?: string }> {
    const cleaned = stripComments(src);
    const entries: { name: string; type?: string }[] = [];
    // Match lines/statements ending with ;
    const reStmt = /uniform\s+([a-zA-Z_]\w*)\s+([^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = reStmt.exec(cleaned)) !== null) {
        const type = m[1]!;
        const decls = m[2]!;
        for (const raw of decls.split(",")) {
            const token = raw.trim();
            if (!token) continue;
            // token may be: name, name[SIZE]
            const nameMatch = /^([a-zA-Z_]\w*)/.exec(token);
            if (nameMatch) {
                entries.push({ name: nameMatch[1]!, type });
            }
        }
    }
    return entries;
}

/**
 * Extract function *definition* names from code (functions + mainCode).
 * Heuristic (regex), but stricter than before:
 *  - Captures `<name>(...) {` so it only matches definitions (not calls or prototypes).
 *  - Filters out control keywords like if/for/while/switch.
 */
export function extractFunctionNames(src: string): ReadonlyArray<string> {
    const cleaned = stripCommentsAndStrings(src);
    const names = new Set<string>();
    // name ( paramlist ) {
    const re = /\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/g;
    const CONTROL = new Set(["if", "for", "while", "switch"]);
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
        const name = m[1]!;
        if (!CONTROL.has(name)) names.add(name);
    }
    return Array.from(names);
}


/**
 * Identifier-aware replacement that skips:
 *  - string literals ('...' or "...")
 *  - line comments (// ...)
 *  - block comments (/* ... *\/)
 *  - preprocessor lines (# ... until newline)
 * Replaces only whole identifiers (word-boundary), case-sensitive.
 */
export function replaceIds(
    src: string,
    mapping: Record<string, string>,
    preserve: Set<string>
): string {
    if (!src) return src;
    const isIdStart = (c: string) => /[A-Za-z_]/.test(c);
    const isIdPart = (c: string) => /[A-Za-z0-9_]/.test(c);

    let out = "";
    let i = 0;
    const n = src.length;

    enum Mode { Code, LineComment, BlockComment, StringSingle, StringDouble, Preproc }
    let mode = Mode.Code;

    while (i < n) {
        const ch = src[i];

        // Mode transitions
        if (mode === Mode.Code) {
            // Preprocessor at line start (permit leading whitespace)
            if ((i === 0 || src[i - 1] === "\n") && ch === "#") {
                mode = Mode.Preproc;
                out += ch; i++; continue;
            }
            // Line comment //
            if (ch === "/" && i + 1 < n && src[i + 1] === "/") {
                mode = Mode.LineComment;
                out += "//"; i += 2; continue;
            }
            // Block comment /* */
            if (ch === "/" && i + 1 < n && src[i + 1] === "*") {
                mode = Mode.BlockComment;
                out += "/*"; i += 2; continue;
            }
            // Strings
            if (ch === "'") { mode = Mode.StringSingle; out += ch; i++; continue; }
            if (ch === '"') { mode = Mode.StringDouble; out += ch; i++; continue; }

            // Identifier?
            if (isIdStart(ch)) {
                let j = i + 1;
                while (j < n && isIdPart(src[j])) j++;
                const ident = src.slice(i, j);
                const replacement = (!preserve.has(ident) && mapping[ident]) ? mapping[ident] : ident;
                out += replacement;
                i = j;
                continue;
            }

            // default: passthrough
            out += ch; i++; continue;
        }

        if (mode === Mode.LineComment) {
            out += ch; i++;
            if (ch === "\n") mode = Mode.Code;
            continue;
        }

        if (mode === Mode.BlockComment) {
            out += ch; i++;
            if (ch === "*" && i < n && src[i] === "/") {
                out += "/"; i++; mode = Mode.Code;
            }
            continue;
        }

        if (mode === Mode.StringSingle) {
            out += ch; i++;
            if (ch === "\\" && i < n) { out += src[i]; i++; continue; } // escape
            if (ch === "'") mode = Mode.Code;
            continue;
        }

        if (mode === Mode.StringDouble) {
            out += ch; i++;
            if (ch === "\\" && i < n) { out += src[i]; i++; continue; } // escape
            if (ch === '"') mode = Mode.Code;
            continue;
        }

        if (mode === Mode.Preproc) {
            out += ch; i++;
            if (ch === "\n") mode = Mode.Code;
            continue;
        }
    }

    return out;
}

/** Strip comments only (keep strings) — helpful for uniform parsing. */
export function stripComments(src: string): string {
    // Remove block comments
    let s = src.replace(/\/\*[\s\S]*?\*\//g, "");
    // Remove line comments
    s = s.replace(/\/\/[^\n]*\n?/g, (m) => (m.endsWith("\n") ? "\n" : ""));
    return s;
}

/** Strip both comments and string literals — helpful for scanning defs. */
export function stripCommentsAndStrings(src: string): string {
    // Remove strings
    let s = src.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
    // Remove comments
    s = stripComments(s);
    return s;
}
