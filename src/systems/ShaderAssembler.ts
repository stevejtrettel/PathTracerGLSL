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

export interface AssembledFragment {
    fragment: string;
    /** Map of plugin namespace -> { prefix, uniforms: {local,prefixed,type}[] } */
    uniforms: Record<
    string,
    { prefix: string; uniforms: { local: string; prefixed: string; type: string }[] }
    >;
}

export default class ShaderAssembler {
    buildFragment(plugins: Plugin[]): AssembledFragment {
        if (!plugins.length) throw new Error("ShaderAssembler: no active plugins.");

        // 1) Build uniform declarations + per-chunk replacement maps
        const uniformSpec: AssembledFragment["uniforms"] = {};
        const uniformDeclLines: string[] = [];
        const replaceMap = new Map<GLSLChunk, Map<string, string>>();

        for (const p of plugins) {
            const prefix = this.makePrefix(p.namespace); // e.g., "u_display_srgb_"
            const entries = p.uniforms().map((u) => ({
                local: u.name,
                prefixed: `${prefix}${u.name}`,
                type: u.type,
            }));

            if (entries.length) {
                uniformSpec[p.namespace] = { prefix, uniforms: entries };
                for (const e of entries) uniformDeclLines.push(`uniform ${e.type} ${e.prefixed};`);
            }

            for (const chunk of p.chunks()) {
                const m = new Map<string, string>();
                for (const e of entries) m.set(e.local, e.prefixed);
                replaceMap.set(chunk, m);
            }
        }

        // 2) Collect chunks and enforce uniqueness
        const chunks = plugins.flatMap((p) => p.chunks());
        const byName = new Map<string, GLSLChunk>();
        for (const c of chunks) {
            if (byName.has(c.name)) throw new Error(`ShaderAssembler: duplicate chunk "${c.name}".`);
            byName.set(c.name, c);
        }

        // 3) Topologically order + place geometry first
        const orderedRaw = topoSortChunks(chunks);
        const ordered = this.geometryFirst(orderedRaw);

        // 4) Ensure required contracts exist
        if (!byName.has(ChunkNames.IntegratorIntegrate))
            throw new Error(`ShaderAssembler: missing "${ChunkNames.IntegratorIntegrate}".`);
        if (!byName.has(ChunkNames.DisplayDisplay))
            throw new Error(`ShaderAssembler: missing "${ChunkNames.DisplayDisplay}".`);

        // 5) Apply uniform prefixing & concatenate
        const chunksSource = ordered
            .map((c) => this.applyUniformPrefixing(c.source, replaceMap.get(c)))
            .join("\n\n");

        // 6) Build final fragment
        const fragment = this.buildFragmentTemplate({ uniformLines: uniformDeclLines, chunksSource });

        return { fragment, uniforms: uniformSpec };
    }

    // ---- internals ----

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

${uniformLines.join("\n")}
`;
        const main = `
void main() {
  vec3 color = integrate(gl_FragCoord.xy);
  color = display(color);
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
    const ops   = list.filter((c) => c.name === ChunkNames.GeometryOps);
    const rest  = list.filter(
        (c) => c.name !== ChunkNames.GeometryTypes && c.name !== ChunkNames.GeometryOps
    );
    return [...types, ...ops, ...rest];
}
}
