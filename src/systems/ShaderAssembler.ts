/**
 * ShaderAssembler (systems/)
 * - Collects GLSL chunks + uniforms from Engine plugins
 * - Prefixes uniforms by plugin namespace
 * - Orders chunks via DependencyResolver
 * - Builds a single fragment with canonical main()
 */

import type { GLSLChunk, Plugin, UniformDecl } from "../core/types";
import { ChunkNames } from "../core/types";
import { topoSortChunks } from "./DependencyResolver";

function assertUniqueNamespaces(plugins: Plugin[]) {
    const seen = new Set<string>();
    for (const p of plugins) {
        if (seen.has(p.namespace)) {
            throw new Error(
                `ShaderAssembler: duplicate plugin namespace "${p.namespace}". Namespaces must be unique.`,
            );
        }
        seen.add(p.namespace);
    }
}

export interface AssembledFragment {
    fragment: string;
    uniforms: Record<
        string,
        {
            prefix: string;
            uniforms: { local: string; prefixed: string; type: string }[];
        }
        >;
}

export default class ShaderAssembler {
    buildFragment(plugins: Plugin[]): AssembledFragment {
        if (!plugins.length) throw new Error("ShaderAssembler: no active plugins.");
        assertUniqueNamespaces(plugins);

        // Cache chunks per plugin (critical: call p.chunks() ONCE)
        const chunksPerPlugin = new Map<Plugin, GLSLChunk[]>();

        // Build uniform declarations + per-chunk replacement maps
        const uniformSpec: AssembledFragment["uniforms"] = {};
        const uniformDeclLines: string[] = [];
        const replaceMap = new Map<GLSLChunk, Map<string, string>>();

        for (const p of plugins) {
            const prefix = this.makePrefix(p.namespace);

            // Extract uniform declarations from getUniforms if it exists
            const uniformDecls: UniformDecl[] = [];
            if (p.getUniforms) {
                const specs = p.getUniforms();
                for (const [name, spec] of Object.entries(specs)) {
                    uniformDecls.push({ name, type: spec.type });
                }
            }

            const entries = uniformDecls.map((u) => ({
                local: u.name,
                prefixed: `${prefix}${u.name}`,
                type: u.type,
            }));

            if (entries.length) {
                uniformSpec[p.namespace] = { prefix, uniforms: entries };
                for (const e of entries) uniformDeclLines.push(`uniform ${e.type} ${e.prefixed};`);
            }

            // Call once, reuse the same chunk objects everywhere
            const chunks = p.chunks();
            chunksPerPlugin.set(p, chunks);

            // One replacement map per plugin (same for all its chunks)
            const m = new Map<string, string>();
            for (const e of entries) m.set(e.local, e.prefixed);
            for (const chunk of chunks) {
                replaceMap.set(chunk, m);
            }
        }

        // Collect chunks and enforce uniqueness (DO NOT call p.chunks() again)
        const chunks: GLSLChunk[] = Array.from(chunksPerPlugin.values()).flat();
        const byName = new Map<string, GLSLChunk>();
        for (const c of chunks) {
            if (byName.has(c.name)) throw new Error(`ShaderAssembler: duplicate chunk "${c.name}".`);
            byName.set(c.name, c);
        }

        // Early sanity on declared deps
        for (const c of chunks) {
            for (const d of c.deps ?? []) {
                if (!byName.has(d)) {
                    throw new Error(`ShaderAssembler: chunk "${c.name}" depends on missing "${d}".`);
                }
            }
        }

        // Topologically order + place geometry first
        const orderedRaw = topoSortChunks(chunks);
        const ordered = this.geometryFirst(orderedRaw);

        // Ensure required contracts exist
        this.assertRequiredChunks(byName);

        // Apply uniform prefixing & concatenate
        const chunksSource = ordered
            .map((c) => this.applyUniformPrefixing(c.source, replaceMap.get(c)))
            .join("\n\n");

        // Build final fragment
        const fragment = this.buildFragmentTemplate({ uniformLines: uniformDeclLines, chunksSource });

        return { fragment, uniforms: uniformSpec };
    }

    private buildFragmentTemplate({
                                      uniformLines,
                                      chunksSource,
                                  }: {
        uniformLines: string[];
        chunksSource: string;
    }): string {
        const header = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

// --- Engine global (minimal by design) ---
uniform vec2 u_resolution;

${uniformLines.join("\n")}
`;
        const main = `
void main() {
    vec3 color = integrate(gl_FragCoord.xy);   // provided by integrator
    color = display(color);                    // provided by display
    outColor = vec4(color, 1.0);
}
`;
        return [header.trim(), chunksSource.trim(), main.trim()].join("\n\n");
    }

    private makePrefix(namespace: string): string {
        const safe = namespace.replace(/[^\w]/g, "_");
        return `u_${safe}_`;
    }

    private applyUniformPrefixing(src: string, map?: Map<string, string>): string {
        if (!map || map.size === 0) return src;
        let out = src;
        for (const [local, prefixed] of map.entries()) {
            const re = new RegExp(`\\b${this.escapeRegex(local)}\\b`, "g");
            out = out.replace(re, prefixed);
        }
        return out;
    }

    private escapeRegex(s: string): string {
        return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    private geometryFirst(list: GLSLChunk[]): GLSLChunk[] {
        const types = list.filter((c) => c.name === ChunkNames.GeometryTypes);
        const ops = list.filter((c) => c.name === ChunkNames.GeometryOps);
        const rest = list.filter(
            (c) => c.name !== ChunkNames.GeometryTypes && c.name !== ChunkNames.GeometryOps
        );
        return [...types, ...ops, ...rest];
    }

    private assertRequiredChunks(byName: Map<string, GLSLChunk>) {
        const missing: string[] = [];
        if (!byName.has(ChunkNames.IntegratorIntegrate))
            missing.push(ChunkNames.IntegratorIntegrate);
        if (!byName.has(ChunkNames.DisplayDisplay))
            missing.push(ChunkNames.DisplayDisplay);

        // Advisory (not fatal): geometry chunks are highly recommended
        if (!byName.has(ChunkNames.GeometryTypes)) {
            console.warn(`[ShaderAssembler] Missing optional chunk "${ChunkNames.GeometryTypes}".`);
        }
        if (!byName.has(ChunkNames.GeometryOps)) {
            console.warn(`[ShaderAssembler] Missing optional chunk "${ChunkNames.GeometryOps}".`);
        }

        if (missing.length) {
            throw new Error(`ShaderAssembler: missing required chunks: ${missing.join(", ")}`);
        }
    }
}
