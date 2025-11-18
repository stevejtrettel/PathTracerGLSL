import type { ModuleDescriptor } from '../../../infrastructure/engine/types.js';
import { buildFrame } from "./utils/buildFrame";

/**
 * Pinhole camera module
 * Generates rays from screen coordinates using ideal pinhole camera model
 *
 * Supports two modes:
 * 1. Look-at mode: Provide position + target, frame is computed
 * 2. Direct mode: Provide position + frame directly (for 6DOF controls)
 */
const pinholeCamera: ModuleDescriptor = {
    id: {
        kind: 'camera',
        name: 'pinhole',
        version: '1.0.0'
    },

    parameters: {
        'camera.position': {
            type: 'vec3',
            default: [0, 0, 5],
            name: 'Position',
            help: 'Camera position in world space'
        },
        'camera.target': {
            type: 'vec3',
            default: [0, 0, 0],
            name: 'Look At',
            help: 'Point the camera is looking at (orbit controls)'
        },
        'camera.fov': {
            type: 'float',
            default: 60,
            range: [10, 170],
            step: 1,
            unit: 'degrees',
            name: 'Field of View',
            help: 'Vertical field of view angle'
        }
    },

    fragment: {
        uniforms: `
      uniform vec3 u_camera_position;    // Camera position in world space
      uniform mat3 u_camera_frame;       // Camera orientation: [right, up, forward] as columns
      uniform float u_camera_tan_fov;    // tan(fov_y / 2) for vertical field of view
    `,

        functions: `
      Ray camera_generateRay(vec2 pixel, vec2 xi) {
        // Convert pixel coordinates to normalized device coordinates [-1, 1]
  
          // xi is in [0,1], so shift to [-0.5, 0.5] for centered jitter
          vec2 jittered_pixel = pixel + (xi - 0.5);
    
         // Now convert to NDC using the jittered position
         vec2 ndc = (2.0 * jittered_pixel / u_image_size) - 1.0;

        
        // Account for aspect ratio - correct x coordinate
        float aspect = u_image_size.x / u_image_size.y;
        ndc.x *= aspect;
        
        // Convert to camera space direction using field of view
        // Camera looks down negative Z, so forward direction gets negative Z
        vec3 camera_dir = vec3(
          ndc.x * u_camera_tan_fov,    // Right component
          ndc.y * u_camera_tan_fov,    // Up component  
          -1.0                         // Forward (negative Z in camera space)
        );
        
        // Normalize camera space direction
        camera_dir = normalize(camera_dir);
        
        // Transform camera space direction to world space using camera frame
        // u_camera_frame has [right, up, forward] as columns
        Direction world_dir = u_camera_frame * camera_dir;
        
        // Create ray from camera position along world direction
        Ray ray;
        ray.origin = u_camera_position;
        ray.direction = world_dir;
        ray.tmin = 0.001;  // Small offset to avoid self-intersection
        ray.tmax = 1000.0; // Far clipping distance
        
        return ray;
      }
    `
    },

    uniformBindings: [
        {
            uniform: 'u_camera_position',
            parameters: ['camera.position'],
            type: 'vec3',
            compute: (params) => params['camera.position']
        },
        {
            uniform: 'u_camera_tan_fov',
            parameters: ['camera.fov'],
            type: 'float',
            compute: (params) => Math.tan(params['camera.fov'] * Math.PI / 180 / 2)
        },
        {
            uniform: 'u_camera_frame',
            parameters: ['camera.position', 'camera.target', 'camera.frame'],
            type: 'mat3',
            compute: (params) => {
                // Mode 1: Direct frame (for 6DOF controls)
                // If camera.frame is explicitly set, use it directly
                if (params['camera.frame']) {
                    return params['camera.frame'];
                }

                // Mode 2: Look-at frame (for orbit controls)
                // Build frame from position + target
                if (params['camera.position'] && params['camera.target']) {
                    return buildFrame(params['camera.position'], params['camera.target']);
                }

                // Fallback: identity frame (shouldn't happen in practice)
                console.warn('Camera: Neither frame nor position+target provided, using identity');
                return new Float32Array([
                    1, 0, 0,  // right
                    0, 1, 0,  // up
                    0, 0, 1   // forward
                ]);
            }
        }
    ],

    // exports: ['camera_generateRay']  // Disabled: using GLSL compiler validation instead
};

export { pinholeCamera };
