// src/camera/PinholeCameraPlugin.ts
import type {
    Plugin, GLSLChunk, Role, Stage, PipelineContext, UniformDecl
} from "../core/types";
import { ChunkNames } from "../core/types";
import UniformManager from "../systems/UniformManager"; // ← singular folder

const CAMERA_CHUNK_SRC = /* glsl */`
// camera.generateRay — pinhole camera
// Expects the following uniforms to be declared by the assembler (prefixed):
//   vec3  cam_pos, cam_f, cam_u, cam_r
//   float cam_fovY

Ray generateRay(vec2 filmUV) {
    vec2 ndc = filmUV * 2.0 - 1.0;

    float aspect = u_resolution.x / max(1.0, u_resolution.y);
    float halfH  = tan(0.5 * cam_fovY);
    float halfW  = halfH * aspect;

    Dir dir = normalize(cam_f + ndc.x * halfW * cam_r + ndc.y * halfH * cam_u);
    return makeRay(cam_pos, dir);
}
`;

export interface PinholeOptions { fovYDeg?: number; }

export default class PinholeCameraPlugin implements Plugin {
    readonly role: Role = "camera";
    readonly namespace = "cam.pinhole";

    private fovYRad: number;
    constructor(opts: PinholeOptions = {}) {
        const deg = opts.fovYDeg ?? 60;
        this.fovYRad = (deg * Math.PI) / 180;
    }

    uniforms(): UniformDecl[] {
        const u: UniformDecl[] = [
            { name: "cam_pos",  type: "vec3" },
            { name: "cam_f",    type: "vec3" },
            { name: "cam_u",    type: "vec3" },
            { name: "cam_r",    type: "vec3" },
            { name: "cam_fovY", type: "float" },
        ];
        return u;
    }

    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";
        return [{
            name:   ChunkNames.CameraGenerateRay,
            stage,
            source: CAMERA_CHUNK_SRC,
            deps:   [ChunkNames.GeometryTypes, ChunkNames.GeometryOps],
        }];
    }

    // Optional; Plugin interface doesn’t require it. Tracer passes ctx if available.
    applyUniforms(view: UniformManager, ctx?: PipelineContext) {
        view.set1f("cam_fovY", this.fovYRad);

        const f = ctx?.geometry?.frame as any;
        console.debug("[cam.applyUniforms] frame:", f);
        if (!f) return;

        view.set3f("cam_pos", f.p.x, f.p.y, f.p.z);
        view.set3f("cam_f",   f.f.x, f.f.y, f.f.z);
        view.set3f("cam_u",   f.u.x, f.u.y, f.u.z);
        view.set3f("cam_r",   f.r.x, f.r.y, f.r.z);
    }
}
