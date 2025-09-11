// src/camera/PinholeCameraPlugin.ts
import type {
    Plugin, GLSLChunk, Role, Stage, PipelineContext, UniformSpec
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

    // State as properties
    private fovYRad: number;
    private frame: { p: any; f: any; u: any; r: any } | null = null;

    constructor(opts: PinholeOptions = {}) {
        const deg = opts.fovYDeg ?? 60;
        this.fovYRad = (deg * Math.PI) / 180;
    }

    // Single method for uniforms
    getUniforms(): Record<string, UniformSpec> {
        // Default frame values if no frame from context
        const defaultFrame = {
            p: { x: 0, y: 1.5, z: 5 },
            f: { x: 0, y: 0, z: -1 },
            u: { x: 0, y: 1, z: 0 },
            r: { x: 1, y: 0, z: 0 }
        };

        const f = this.frame || defaultFrame;

        return {
            cam_pos: { type: "vec3", value: [f.p.x, f.p.y, f.p.z] },
            cam_f:   { type: "vec3", value: [f.f.x, f.f.y, f.f.z] },
            cam_u:   { type: "vec3", value: [f.u.x, f.u.y, f.u.z] },
            cam_r:   { type: "vec3", value: [f.r.x, f.r.y, f.r.z] },
            cam_fovY: { type: "float", value: this.fovYRad }
        };
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

    // Method to update frame from context
    updateFromContext(ctx: PipelineContext) {
        if (ctx?.geometry?.frame) {
            this.frame = ctx.geometry.frame as any;
            console.debug("[cam.updateFromContext] frame:", this.frame);
        }
    }

    // Convenience methods for updating state
    setFOV(degrees: number) {
        this.fovYRad = (degrees * Math.PI) / 180;
    }
}




// For the camera to work properly with the geometry frame, you'll need to update your frame loop to:
// typescript// In your animation loop
// camera.updateFromContext(ctx);  // Update camera from geometry
// tracer.frame();                  // Render
