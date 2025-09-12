import type { Plugin, GLSLChunk, UniformDecl } from "../../core/types";
import testIntegrator from "./test_integrator.glsl";

/**
 * TestIntegratorPlugin
 * Role: "integrator"
 * Provides: integrator.integrate -> vec3 integrate(vec2 fragCoord)
 * Notes:
 *  - Returns a constant *HDR* color to exercise the Display plugin next.
 *  - No uniforms yet; we can add a "color" uniform later if desired.
 */
export default class TestIntegrator implements Plugin {
    namespace = "integrator.test";
    role: "integrator" = "integrator";

    chunks(): GLSLChunk[] {
        return [
            {
                name: "integrator.integrate",
                stage: "frag",
                source: testIntegrator,
                deps: [], // none for now (no camera/geometry needed)
            },
        ];
    }

    uniforms(): UniformDecl[] {
        return []; // e.g., later: [{ name: "color", type: "vec3" }]
    }
}
