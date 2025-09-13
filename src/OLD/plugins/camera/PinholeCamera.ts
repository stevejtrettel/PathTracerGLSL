

// src/camera/PinholeCamera.ts
import type {
    Plugin, GLSLChunk, Role, Stage, PipelineContext, UniformDecl,
    ParameterDescriptor, ParameterView  // NEW: Add these types
} from "../../core/types";
import { ChunkNames } from "../../core/types";
import UniformManager from "../../systems/UniformManager";

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

// UPDATED: Add parameters field to options
export interface PinholeOptions {
    fovYDeg?: number;
    parameters?: string[] | boolean;  // NEW: Which parameters to expose
}

export default class PinholeCamera implements Plugin {
    readonly role: Role = "camera";
    readonly namespace = "cam.pinhole";

    private fovYRad: number;
    private exposedParams: Set<string>;  // NEW: Track which params are exposed

    constructor(opts: PinholeOptions = {}) {
        const deg = opts.fovYDeg ?? 60;
        this.fovYRad = (deg * Math.PI) / 180;

        // NEW: Parse parameter exposure
        if (opts.parameters === true) {
            this.exposedParams = new Set(['fov']);
        } else if (Array.isArray(opts.parameters)) {
            this.exposedParams = new Set(opts.parameters);
        } else {
            this.exposedParams = new Set();
        }
    }

    // NEW: Declare available parameters
    parameters(): ParameterDescriptor[] {
        if (!this.exposedParams.has('fov')) return [];

        return [{
            name: 'fov',
            displayName: 'Field of View',
            type: 'angle',
            default: 60,
            min: 10,
            max: 120,
            step: 1,
            unit: 'degrees',
            uiHint: 'slider',
            group: 'Camera'
        }];
    }

    // NEW: Update internal state from parameters
    applyParameters(params: ParameterView, ctx?: PipelineContext): void {
        if (this.exposedParams.has('fov')) {
            const fovDeg = params.get('fov');
            if (fovDeg !== undefined) {
                this.fovYRad = (fovDeg * Math.PI) / 180;
            }
        }
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

    applyUniforms(view: UniformManager, ctx?: PipelineContext) {
        // Use the potentially updated fovYRad value
        view.set1f("cam_fovY", this.fovYRad);

        const f = ctx?.geometry?.frame as any;
        if (!f) return;

        view.set3f("cam_pos", f.p.x, f.p.y, f.p.z);
        view.set3f("cam_f",   f.f.x, f.f.y, f.f.z);
        view.set3f("cam_u",   f.u.x, f.u.y, f.u.z);
        view.set3f("cam_r",   f.r.x, f.r.y, f.r.z);
    }
}
