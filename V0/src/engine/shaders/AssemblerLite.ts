/**
 * Research Path Tracer — AssemblerLite (v1)
 *
 * Purpose
 *   Assemble one concrete fragment shader from a set of module descriptors:
 *     - inject a small system prelude (reserved uniforms),
 *     - validate that provided symbols satisfy all requires,
 *     - prefix module-local uniform names with a stable engine prefix,
 *     - concatenate module GLSL in a fixed order,
 *     - append a caller-supplied "glue" block (e.g., main() that calls tracePixel).
 *
 * Scope (v1)
 *   - Fragment stage only (no vertex/compute assembly).
 *   - No #ifdefs or feature flags; one assembled variant per pipeline.
 *   - Uniform prefixing is conservative (identifier-aware regex with word boundaries).
 *     We will harden it in v2 to be fully comment/string-literal aware.
 */

import {
    SYSTEM_UNIFORMS,
    validateRequirements,
} from '../../core/contracts/Descriptors';

import type { ModuleDescriptorBase } from '../../core/contracts/Descriptors';

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Assemble a fragment shader from N modules in the given order and a small glue snippet.
 * The glue is appended at the end (e.g., defines main() and calls a provided symbol).
 *
 * Typical usage:
 *   const src = assembleFragment(
 *     [camera, world, tracer],
 *     `in vec2 v_uv; out vec4 fragColor; void main(){ fragColor = tracePixel(v_uv); }`
 *   );
 */
export function assembleFragment(
    modulesInOrder: ReadonlyArray<ModuleDescriptorBase>,
    glue: string
): string {
    // 1) Validate requirements against provided symbol names.
    const provided = collectProvided(modulesInOrder);
    for (const m of modulesInOrder) {
        validateRequirements(m.id, m.requires ?? [], provided);
    }

    // 2) Build system prelude + prefixed modules.
    const sys = systemPrelude();
    const prefixedPieces: string[] = [];

    for (const m of modulesInOrder) {
        const { glsl } = prefixModuleUniforms(m);
        prefixedPieces.push(glsl);
    }

    // 3) Compose final fragment (stable, readable structure).
    const body =
        [
            '// ----[ system prelude ]----',
            sys.trim(),
            '',
            ...prefixedPieces.map((s, i) => `// ----[ module ${i} (${modulesInOrder[i].id}) ]----\n${s.trim()}`),
            '',
            '// ----[ glue ]----',
            glue.trim(),
        ].join('\n\n') + '\n';

    return wrapFragment(body);
}

/**
 * Helper for a trace pipeline (v1): Camera → (optional World) → Tracer.
 * Emits a fragment that calls `tracePixel(v_uv)` into fragColor.
 *
 * Overloads:
 *   assembleTraceFragment(camera, tracer)
 *   assembleTraceFragment(camera, world, tracer)
 */
export function assembleTraceFragment(
    camera: ModuleDescriptorBase,
    tracer: ModuleDescriptorBase
): string;
export function assembleTraceFragment(
    camera: ModuleDescriptorBase,
    world: ModuleDescriptorBase,
    tracer: ModuleDescriptorBase
): string;
export function assembleTraceFragment(
    camera: ModuleDescriptorBase,
    a: ModuleDescriptorBase,
    b?: ModuleDescriptorBase
): string {
    const hasWorld = !!b;
    const world = hasWorld ? a : undefined;
    const tracer = hasWorld ? (b as ModuleDescriptorBase) : a;

    // Minimal ABI presence checks (nice errors if a dev wires the wrong thing).
    ensureProvides(camera, 'generateRay');   // camera must provide a ray generator in v1
    ensureProvides(tracer, 'tracePixel');    // tracer must provide the pixel entrypoint

    const modules = hasWorld ? [camera, world!, tracer] : [camera, tracer];

    const glue = `
    // v1 glue: expose varyings & write to fragColor
    in vec2 v_uv;
    out vec4 fragColor;
    void main() {
      fragColor = tracePixel(v_uv);
    }
  `;

    return assembleFragment(modules, glue);
}

/* -------------------------------------------------------------------------- */
/* Internal helpers (pure; easy to test)                                      */
/* -------------------------------------------------------------------------- */

/** System prelude injected at the top of every assembled fragment. */
export function systemPrelude(): string {
    return `
    // --- system uniforms (reserved names; engine binds per frame) ---
    uniform vec2 ${SYSTEM_UNIFORMS.resolution};
    uniform int  ${SYSTEM_UNIFORMS.frame};
    uniform float ${SYSTEM_UNIFORMS.time};

    // Note: v_uv is produced by the fullscreen vertex shader; declared in glue.
    // Note: fragColor is declared in glue as well.
  `;
}

/**
 * Wrap a fragment body with #version and precision header.
 * Body must declare/assume any needed varyings/outs via glue.
 */
export function wrapFragment(body: string): string {
    return [
        '#version 300 es',
        'precision highp float;',
        '',
        body.trim(),
    ].join('\n') + '\n';
}

/** Collect symbol names provided by the given modules (for requires-validation). */
export function collectProvided(mods: ReadonlyArray<ModuleDescriptorBase>): ReadonlySet<string> {
    const names = new Set<string>();
    for (const m of mods) {
        for (const s of m.provides) {
            names.add(s.name);
        }
    }
    return names;
}

/** Ensure module `mod` provides a named symbol (nice error if not). */
export function ensureProvides(mod: ModuleDescriptorBase, requiredSymbol: string): void {
    const ok = mod.provides?.some(p => p.name === requiredSymbol);
    if (!ok) {
        throw new Error(`[AssemblerLite] Module '${mod.id}' does not provide '${requiredSymbol}'.`);
    }
}

/**
 * Compute the engine prefix for a module’s uniforms:
 *   g_<id with dots replaced by underscores>_
 * Example:
 *   id: "tracer.flat_color" → "g_tracer_flat_color_"
 */
export function modulePrefix(mod: ModuleDescriptorBase): string {
    return 'g_' + mod.id.replace(/[^\w]+/g, '_') + '_';
}

/**
 * Return a version of the module with its uniform declarations and *uses* rewritten
 * to the prefixed form. The returned object shares the original descriptor identity
 * but supplies a transformed GLSL string.
 *
 * v1 implementation notes:
 *   - We rewrite: (a) uniform declarations, and (b) bare identifier uses with \\bword\\b.
 *   - This is conservative and assumes uniform identifiers do not appear inside comments
 *     or string literals. In v2, we will implement a lightweight tokenizer to avoid false
 *     positives while preserving comments.
 */
export function prefixModuleUniforms(mod: ModuleDescriptorBase): { glsl: string; map: Map<string, string> } {
    const src = mod.glsl;
    const decls = mod.uniforms ?? [];
    if (decls.length === 0) return { glsl: src, map: new Map() };

    const prefix = modulePrefix(mod);
    const map = new Map<string, string>();
    for (const u of decls) {
        map.set(u.name, prefix + u.name);
    }

    // 1) Rewrite uniform declarations: "uniform <type> <name>;" → "uniform <type> <prefix><name>;"
    //    (allow optional whitespace and array suffixes for future-proofing)
    let out = src;
    for (const u of decls) {
        const declRe = new RegExp(
            String.raw`(\buniform\s+${glslTypePattern(u.type)}\s+)${u.name}(\s*(\[[^\]]+\])?\s*;)`,
            'g'
        );
        out = out.replace(declRe, (_m, head: string, tail: string) => `${head}${prefix}${u.name}${tail}`);
    }

    // 2) Rewrite identifier uses with word-boundary replacement.
    //    NOTE: v1 limitation — may also replace inside comments/strings if present.
    //    Keep modules’ GLSL clean (no comments referencing uniform names) until v2 tokenizer.
    for (const u of decls) {
        const idRe = new RegExp(String.raw`\b${u.name}\b`, 'g');
        out = out.replace(idRe, prefix + u.name);
    }

    return { glsl: out, map };
}

/** Tiny helper: pattern fragment for uniform GLSL types we accept in v1. */
function glslTypePattern(t: NonNullable<ModuleDescriptorBase['uniforms']>[number]['type']): string {
    // Exact tokens; we don’t match qualifiers here (no 'layout', etc.) in v1.
    return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
