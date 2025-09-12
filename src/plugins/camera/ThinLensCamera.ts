// src/camera/ThinLensCameraPlugin.ts
import type {
    Plugin, GLSLChunk, Role, Stage, PipelineContext, UniformDecl,
    ParameterDescriptor, ParameterView
} from "../../core/types";
import { ChunkNames } from "../../core/types";
import UniformManager from "../../systems/UniformManager";

const THIN_LENS_CHUNK_SRC = /* glsl */`
// camera.generateRay — thin lens camera with depth of field
// Uniforms:
//   vec3  cam_pos, cam_f, cam_u, cam_r
//   float cam_fovY
//   float cam_aperture    (radius of lens aperture)
//   float cam_focusDist   (distance to focal plane)

// Simple deterministic lens sampling for now
// In the future, pass random vec2 for proper DOF
vec2 sampleLens(vec2 uv) {
    // Convert square to disk (concentric mapping)
    vec2 offset = 2.0 * uv - 1.0;
    if (offset.x == 0.0 && offset.y == 0.0) return vec2(0.0);
    
    float theta, r;
    if (abs(offset.x) > abs(offset.y)) {
        r = offset.x;
        theta = (3.14159265 / 4.0) * (offset.y / offset.x);
    } else {
        r = offset.y;
        theta = (3.14159265 / 2.0) - (3.14159265 / 4.0) * (offset.x / offset.y);
    }
    
    return r * vec2(cos(theta), sin(theta));
}

Ray generateRay(vec2 filmUV) {
    vec2 ndc = filmUV * 2.0 - 1.0;
    
    float aspect = u_resolution.x / max(1.0, u_resolution.y);
    float halfH = tan(0.5 * cam_fovY);
    float halfW = halfH * aspect;
    
    // Ray through center of lens (pinhole ray)
    Dir centerDir = normalize(cam_f + ndc.x * halfW * cam_r + ndc.y * halfH * cam_u);
    
    // If aperture is tiny, behave like pinhole
    if (cam_aperture < 0.001) {
        return makeRay(cam_pos, centerDir);
    }
    
    // Sample point on lens (deterministic for now - use gl_FragCoord for variation)
    vec2 seed = gl_FragCoord.xy / u_resolution;
    vec2 lensSample = fract(seed * 13.37 + vec2(0.3, 0.7));
    vec2 lensPoint = cam_aperture * sampleLens(lensSample);
    
    // Compute focal point where pinhole ray hits focal plane
    vec3 focalPoint = cam_pos + cam_focusDist * centerDir;
    
    // Ray from lens sample point to focal point
    vec3 lensPos = cam_pos + lensPoint.x * cam_r + lensPoint.y * cam_u;
    Dir dofDir = normalize(focalPoint - lensPos);
    
    return makeRay(lensPos, dofDir);
}
`;

export interface ThinLensOptions {
    // Initial values
    fovYDeg?: number;
    aperture?: number;        // Physical aperture radius in world units
    focusDistance?: number;   // Distance to focal plane

    // Convenience: set aperture via f-stop (requires focal length)
    fStop?: number;
    focalLengthMM?: number;

    // Which parameters to expose
    parameters?: string[] | boolean;
}

export default class ThinLensCamera implements Plugin {
    readonly role: Role = "camera";
    readonly namespace = "cam.thinlens";

    // Internal state
    private fovYRad: number;
    private aperture: number;
    private focusDistance: number;
    private focalLengthMM: number;

    // Track exposed parameters
    private exposedParams: Set<string>;

    constructor(opts: ThinLensOptions = {}) {
        // Set defaults
        this.fovYRad = (opts.fovYDeg ?? 60) * Math.PI / 180;
        this.focusDistance = opts.focusDistance ?? 5.0;
        this.focalLengthMM = opts.focalLengthMM ?? 50;

        // Aperture can be set directly or via f-stop
        if (opts.aperture !== undefined) {
            this.aperture = opts.aperture;
        } else if (opts.fStop !== undefined) {
            // aperture radius = focal_length / (2 * f_stop)
            // Convert mm to world units (assuming 1 unit = 1 meter)
            this.aperture = (this.focalLengthMM / 1000) / (2 * opts.fStop);
        } else {
            this.aperture = 0.025; // Default ~f/2.0 with 50mm lens
        }

        // Parse parameter exposure
        if (opts.parameters === true) {
            this.exposedParams = new Set(['fov', 'aperture', 'focusDistance']);
        } else if (Array.isArray(opts.parameters)) {
            this.exposedParams = new Set(opts.parameters);
        } else {
            this.exposedParams = new Set();
        }
    }

    parameters(): ParameterDescriptor[] {
        const params: ParameterDescriptor[] = [];

        if (this.exposedParams.has('fov')) {
            params.push({
                name: 'fov',
                displayName: 'Field of View',
                type: 'angle',
                default: 60,
                min: 10,
                max: 120,
                step: 1,
                unit: 'degrees',
                uiHint: 'slider',
                group: 'Lens'
            });
        }

        if (this.exposedParams.has('aperture')) {
            params.push({
                name: 'aperture',
                displayName: 'Aperture Size',
                type: 'float',
                default: this.aperture,
                min: 0,
                max: 0.1,
                step: 0.001,
                unit: 'm',
                uiHint: 'slider',
                group: 'Depth of Field'
            });
        }

        if (this.exposedParams.has('fStop')) {
            params.push({
                name: 'fStop',
                displayName: 'f-stop',
                type: 'float',
                default: 2.8,
                options: [1.0, 1.4, 2.0, 2.8, 4.0, 5.6, 8.0, 11, 16, 22, 32],
                uiHint: 'dropdown',
                group: 'Depth of Field'
            });
        }

        if (this.exposedParams.has('focusDistance')) {
            params.push({
                name: 'focusDistance',
                displayName: 'Focus Distance',
                type: 'float',
                default: this.focusDistance,
                min: 0.1,
                max: 50,
                step: 0.1,
                unit: 'm',
                uiHint: 'slider',
                group: 'Depth of Field'
            });
        }

        return params;
    }

    applyParameters(params: ParameterView, ctx?: PipelineContext): void {
        if (this.exposedParams.has('fov')) {
            const fovDeg = params.get('fov');
            if (fovDeg !== undefined) {
                this.fovYRad = fovDeg * Math.PI / 180;
            }
        }

        if (this.exposedParams.has('aperture')) {
            const aperture = params.get('aperture');
            if (aperture !== undefined) {
                this.aperture = aperture;
            }
        }

        if (this.exposedParams.has('fStop')) {
            const fStop = params.get('fStop');
            if (fStop !== undefined) {
                this.aperture = (this.focalLengthMM / 1000) / (2 * fStop);
            }
        }

        if (this.exposedParams.has('focusDistance')) {
            const focusDist = params.get('focusDistance');
            if (focusDist !== undefined) {
                this.focusDistance = focusDist;
            }
        }
    }

    uniforms(): UniformDecl[] {
        return [
            { name: "cam_pos",       type: "vec3" },
            { name: "cam_f",         type: "vec3" },
            { name: "cam_u",         type: "vec3" },
            { name: "cam_r",         type: "vec3" },
            { name: "cam_fovY",      type: "float" },
            { name: "cam_aperture",  type: "float" },
            { name: "cam_focusDist", type: "float" },
        ];
    }

    chunks(): GLSLChunk[] {
        return [{
            name:   ChunkNames.CameraGenerateRay,
            stage:  "frag",
            source: THIN_LENS_CHUNK_SRC,
            deps:   [ChunkNames.GeometryTypes, ChunkNames.GeometryOps],
        }];
    }

    applyUniforms(view: UniformManager, ctx?: PipelineContext) {
        // Camera parameters
        view.set1f("cam_fovY", this.fovYRad);
        view.set1f("cam_aperture", this.aperture);
        view.set1f("cam_focusDist", this.focusDistance);

        // Frame from context
        const f = ctx?.geometry?.frame as any;
        if (!f) return;

        view.set3f("cam_pos", f.p.x, f.p.y, f.p.z);
        view.set3f("cam_f",   f.f.x, f.f.y, f.f.z);
        view.set3f("cam_u",   f.u.x, f.u.y, f.u.z);
        view.set3f("cam_r",   f.r.x, f.r.y, f.r.z);
    }
}
