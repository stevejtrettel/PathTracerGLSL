// src/engine/shaders/shader-compiler.ts
/**
 * shader-compiler.ts — v1.2.1
 * ------------------------------------------------------------
 * PURPOSE
 *   Take an AssemblyRecipe (modules + constants + entrypoint) and produce
 *   deterministic, branch-free GLSL source code (vertex + fragment),
 *   along with a manifest for uniform binding and diagnostics.
 */

import type { AssemblyRecipe } from "./assembly-recipe";
import type { ShaderModuleDescriptor } from "../../core/shader-fragment";
import { linkRecipe } from "./dependency-linker";
import {
    namespaceModule,
    makeModulePrefix,
    type ModuleNamespaceResult,
} from "./namespacing";
import { formatComponentLabel } from "../../core/ids";

/** Minimal manifest entry for runtime binding (covers all uniforms). */
export interface UniformManifestEntry {
    logicalName: string;
    namespacedName: string;
    type?: string;
    owner: { kind: string; name: string; version: string };
}

/** GLSL sampler types supported in v1. */
export type SamplerType =
    | "sampler2D" | "sampler2DArray"
    | "samplerCube" | "samplerCubeArray"
    | "sampler3D"
    | "sampler2DShadow" | "sampler2DArrayShadow" | "samplerCubeShadow"
    | "isampler2D" | "usampler2D"
    | "isampler3D" | "usampler3D"
    | "isamplerCube" | "usamplerCube"
    | "isampler2DArray" | "usampler2DArray";

/** One sampler binding discovered during compilation. */
export interface SamplerBinding {
    logical: string;
    namespaced: string;
    type: SamplerType;
    arraySize?: number;
}

/** Manifest returned to the engine. */
export interface UniformManifest {
    /** All uniforms (sampler + non-sampler) with provenance. */
    entries: ReadonlyArray<UniformManifestEntry>;
    /** Non-sampler uniforms only: logical → namespaced. */
    byLogical: Readonly<Record<string, string>>;
    /** Non-sampler uniforms only: namespaced → logical. */
    byNamespaced: Readonly<Record<string, string>>;
    /** Sampler uniforms only (excluded from the maps above). */
    samplers: ReadonlyArray<SamplerBinding>;
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

    // 7) Build manifest (linear-time, no lookups)
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
        // strings are non-native; emit as comment for diagnostics
        return `// const (string) ${k} = "${(v as string).replace(/"/g, '\\"')}"`;
    });
    return lines.join("\n");
}

function bannerForModule(m: ShaderModuleDescriptor): string {
    return `${m.id.kind}/${m.id.name}@${m.id.version} [${makeModulePrefix(m.id)}]`;
}

function isSamplerType(t?: string): t is SamplerType {
    if (!t) return false;
    // i|u for integer samplers, optional Array and Shadow suffixes
    return /^(?:[iu]?sampler)(?:2D|3D|Cube)(?:Array)?(?:Shadow)?$/i.test(t);
}

function buildManifest(
    ordered: ReadonlyArray<ShaderModuleDescriptor>,
    results: ReadonlyArray<ModuleNamespaceResult>
): UniformManifest {
    const entries: UniformManifestEntry[] = [];
    const byLogical: Record<string, string> = {};
    const byNamespaced: Record<string, string> = {};
    const samplers: SamplerBinding[] = [];

    for (let i = 0; i < ordered.length; i++) {
        const owner = ordered[i]!.id;
        const r = results[i]!;
        for (const u of r.uniformMappings) {
            const e: UniformManifestEntry = {
                logicalName: u.logicalName,
                namespacedName: u.namespacedName,
                type: u.type,
                owner: { kind: owner.kind, name: owner.name, version: owner.version },
            };
            entries.push(e);

            if (isSamplerType(u.type)) {
                samplers.push({
                    logical: u.logicalName,
                    namespaced: u.namespacedName,
                    type: u.type as SamplerType,
                    arraySize: (u as any).arraySize, // optional metadata from namespacer
                });
            } else {
                byLogical[u.logicalName] = u.namespacedName;
                byNamespaced[u.namespacedName] = u.logicalName;
            }
        }
    }

    return { entries, byLogical, byNamespaced, samplers };
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
