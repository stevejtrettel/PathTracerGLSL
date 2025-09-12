import type { Plugin, GLSLChunk, UniformDecl } from "../../core/types";
import srgbDisplay from "./srgb_display.glsl";

/**
 * SRGBDisplayPlugin
 * Role: "display"
 * Provides: display.display -> vec3 display(vec3 hdr)
 * Notes:
 *  - No uniforms yet (exposure, gamma, ACES etc. can be added later).
 */
export default class SRGBDisplay implements Plugin {
    namespace = "display.srgb";
    role: "display" = "display";

    chunks(): GLSLChunk[] {
        return [
            {
                name: "display.display",
                stage: "frag",
                source: srgbDisplay,
                deps: [], // can depend on common math later if needed
            },
        ];
    }

    uniforms(): UniformDecl[] {
        return [];
    }
}
