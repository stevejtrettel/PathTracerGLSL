import type { Plugin, GLSLChunk, Role, Stage } from "../../core/types";
import { ChunkNames } from "../../core/types";

// Adjust paths to your layout; plain .glsl is fine if you have a *.glsl module typing.
import typesSrc from "./glsl/euclidean.types.glsl";
import opsSrc   from "./glsl/euclidean.ops.glsl";

export default class EuclideanGeometryPlugin implements Plugin {
    readonly role: Role = "geometry";
    readonly namespace = "geo.euc";

    uniforms() { return []; }

    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";

        const typesChunk: GLSLChunk = {
            name:   ChunkNames.GeometryTypes,
            stage,
            source: typesSrc,
            // deps intentionally omitted to avoid TS narrowing on []
        };

        const opsChunk: GLSLChunk = {
            name:   ChunkNames.GeometryOps,
            stage,
            source: opsSrc,
            deps:  [ChunkNames.GeometryTypes], // OK: readonly string[] is accepted
        };

        return [typesChunk, opsChunk];
    }
}
