import type { Plugin, GLSLChunk, Role, Stage, UniformDecl } from "../../core/types";
import { ChunkNames } from "../../core/types";

export default class TonemapSRGB implements Plugin {
    readonly role: Role = "postprocess";
    readonly namespace = "postprocess.tonemap_srgb";

    uniforms(): UniformDecl[] { return []; }

    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";
        const source = /* glsl */`
      vec3 tonemapReinhard(vec3 x) { return x / (x + vec3(1.0)); }

      vec3 linear_to_srgb(vec3 c) {
        vec3 a = 12.92 * c;
        vec3 b = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
        return mix(a, b, step(vec3(0.0031308), c));
      }

      // --- postprocess entrypoint ---
      vec3 postprocess(vec3 hdr) {
        vec3 ldr = tonemapReinhard(hdr);
        ldr = clamp(ldr, 0.0, 1.0);
        return linear_to_srgb(ldr);
      }
    `;
        return [{
            name:   ChunkNames.PostprocessApply,
            stage,
            source,
            deps: [], // self-contained
        }];
    }
}
