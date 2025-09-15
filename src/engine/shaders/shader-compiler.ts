// src/engine/shaders/shader-compiler.ts
/**
 * shader-compiler.ts — v1.1
 * ------------------------------------------------------------
 * PURPOSE
 *   Take an AssemblyRecipe (modules + constants + entrypoint) and produce
 *   deterministic, branch-free GLSL source code (vertex + fragment),
 *   along with a manifest for uniform binding and diagnostics.
 *
 * CORE RESPONSIBILITIES
 *   1. Collect ShaderFragments from all modules in the recipe.
 *   2. Inline compile-time constants (as `const` declarations).
 *   3. Resolve `requires`/`provides` dependencies (via linkRecipe):
 *        - Build a symbol table from all `provides`.
 *        - Ensure each `requires` resolves to exactly one provider.
 *        - Throw if missing or ambiguous.
 *   4. Namespace module-local identifiers (uniforms, private helpers)
 *      based on ComponentID to avoid collisions, while preserving public
 *      symbols listed in `provides`/`requires` (so linking works).
 *   5. Prune unreachable modules (handled during linking).
 *   6. Emit a canonical `main()` that delegates to the entry symbol.
 *   7. Return:
 *        - vertexSrc: deterministic fullscreen-quad vertex shader
 *        - fragmentSrc: assembled GLSL fragment shader
 *        - manifest: mapping of logical uniform names → namespaced uniforms
 *        - diagnostics: warnings, link report summary
 *
 * INVARIANTS
 *   - Output GLSL contains no `#if/#ifdef` conditionals for feature toggles.
 *   - Identical recipes always produce identical GLSL (byte-for-byte).
 *
 * ERROR HANDLING
 *   - Throws on missing symbols, multiple providers, duplicate uniforms in a
 *     module (namespacer check), or multiple/no entry providers.
 *   - Error messages reference ComponentIDs and symbol names for clarity.
 *
 * EVOLUTION NOTES
 *   - v1.2 may introduce optional AST-based optimization passes.
 *   - v2 may add multipass compilation via Recipe DAGs.
 */

import type { AssemblyRecipe } from "./assembly-recipe";
import type {
    ShaderModuleDescriptor,
    NormalizedShaderFragment,
} from "../../core/shader-fragment";
import { normalizeShaderFragment } from "../../core/shader-fragment";
import { linkRecipe } from "./dependency-linker";
import {
    namespaceModule,
    makeModulePrefix,
    type ModuleNamespaceResult,
} from "./namespacing";
import { formatComponentLabel } from "../../core/ids";

/** Minimal manifest for runtime binding. */
export interface UniformManifestEntry {
    logicalName: string;
    namespacedName: string;
    type?: string;
    owner: { kind: string; name: string; version: string };
}
export interface UniformManifest {
    entries: ReadonlyArray<UniformManifestEntry>;
    byLogical: Readonly<Record<string, string>>;
    byNamespaced: Readonly<Record<string, string>>;
}

/** Compiler result. */
export interface CompileOutput {
    vertexSrc: string;
    fragmentSrc: string;
    manifest: UniformManifest;
    diagnostics: { warnings: string[]; entrySymbol: string; moduleOrder: string[] };
}

/** Compile a single-pass fragment program and a fixed vertex template. */
export function compileRecipe(recipe: AssemblyRecipe): CompileOutput {
    // 1) Resolve dependencies & reachability
    const report = linkRecipe(recipe);
    const ordered = report.resolvedOrder;

    // 2) Build set of public symbols to preserve during namespacing
    const preserve = new Set<string>([recipe.entry.name]);
    for (const m of ordered) {
        for (const s of m.fragment.provides ?? []) preserve.add(s);
        for (const s of m.fragment.requires ?? []) preserve.add(s);
    }

    // 3) Namespace each reachable module, collect code and uniform mappings
    const modResults: ModuleNamespaceResult[] = [];
    const banners: string[] = [];
    for (const m of ordered) {
        const res = namespaceModule(m, { preserve: Array.from(preserve) });
        modResults.push(res);
        banners.push(bannerForModule(m));
    }

    // 4) Emit constants block (as const declarations)
    const constBlock = renderConstants(recipe);

    // 5) Compose fragment sections deterministically
    const enginePrelude = FRAGMENT_ENGINE_PRELUDE.trim();
    const uniformsJoined = modResults.map((r) => r.uniforms).filter(Boolean).join("\n");
    const functionsJoined = modResults
        .map((r, i) => `\n// --- ${banners[i]} (functions) ---\n${r.functions}`)
        .join("\n");
    const mainBodies = modResults
        .map((r, i) => (r.mainCode?.trim() ? `\n// --- ${banners[i]} (mainCode) ---\n${r.mainCode}` : ""))
        .filter(Boolean)
        .join("\n");

    const entry = recipe.entry.name;
    const fragmentSrc = [
        FRAGMENT_HEADER.trim(),
        enginePrelude,
        constBlock,
        uniformsJoined,
        functionsJoined,
        mainBodies,
        FRAGMENT_MAIN_WRAPPER(entry).trim(),
    ]
        .filter(Boolean)
        .join("\n\n")
        .replace(/\n{3,}/g, "\n\n"); // tidy extra whitespace

    // 6) Vertex template (kept inline for now to avoid extra file)
    const vertexSrc = VERTEX_TEMPLATE.trim();

    // 7) Build manifest
    const manifest = buildManifest(ordered, modResults);

    // 8) Diagnostics
    const warnings = [...report.warnings];
    const moduleOrder = ordered.map((m) => formatComponentLabel(m.id));
    return {
        vertexSrc,
        fragmentSrc,
        manifest,
        diagnostics: { warnings, entrySymbol: entry, moduleOrder },
    };
}

/* ----------------------------- helpers ----------------------------- */

function renderConstants(recipe: AssemblyRecipe): string {
    const c = recipe.constants ?? {};
    const keys = Object.keys(c).sort();
    if (!keys.length) return "";
    const lines = keys.map((k) => {
        const v = c[k];
        if (typeof v === "number") {
            // int vs float: emit numeric as-is; user can pass 3.0 if needed
            return `const ${Number.isInteger(v) ? "int" : "float"} ${k} = ${v};`;
        }
        if (typeof v === "boolean") {
            return `const bool ${k} = ${v ? "true" : "false"};`;
        }
        // string: emit as a comment + a const with a hashed code, since GLSL lacks strings
        // we keep it simple here: comment only (useful for diagnostics)
        return `// const (string) ${k} = "${(v as string).replace(/"/g, '\\"')}"`;
    });
    return lines.join("\n");
}

function bannerForModule(m: ShaderModuleDescriptor): string {
    return `${m.id.kind}/${m.id.name}@${m.id.version} [${makeModulePrefix(m.id)}]`;
}

function buildManifest(
    ordered: ReadonlyArray<ShaderModuleDescriptor>,
    results: ReadonlyArray<ModuleNamespaceResult>
): UniformManifest {
    const entries: UniformManifestEntry[] = [];
    for (let i = 0; i < ordered.length; i++) {
        const owner = ordered[i]!.id;
        for (const u of results[i]!.uniformMappings) {
            entries.push({
                logicalName: u.logicalName,
                namespacedName: u.namespacedName,
                type: u.type,
                owner: { kind: owner.kind, name: owner.name, version: owner.version },
            });
        }
    }
    const byLogical: Record<string, string> = {};
    const byNamespaced: Record<string, string> = {};
    for (const e of entries) {
        // If two modules use the same logical name, last-wins in this view;
        // we still keep all entries to preserve provenance.
        byLogical[e.logicalName] = e.namespacedName;
        byNamespaced[e.namespacedName] = e.logicalName;
    }
    return { entries, byLogical, byNamespaced };
}

/* ----------------------------- emitted GLSL ----------------------------- */

const FRAGMENT_HEADER = `#version 300 es
precision highp float;`;

const FRAGMENT_ENGINE_PRELUDE = `
in vec2 v_uv;
out vec4 outColor;
// Engine-level uniforms kept minimal and stable:
uniform vec2 u_resolution;
uniform int  u_frameIndex;
`;

function FRAGMENT_MAIN_WRAPPER(entrySymbol: string): string {
    return `
void main() {
  // Canonical entry call. Convention: entry returns linear RGB in [0, +inf).
  vec3 color = ${entrySymbol}(gl_FragCoord.xy);
  outColor = vec4(color, 1.0);
}
`;
}

const VERTEX_TEMPLATE = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = 0.5 * (a_position + 1.0);
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;
