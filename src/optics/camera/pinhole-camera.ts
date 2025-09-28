import type { ModuleDescriptor } from '../../engine/types.js';
import {buildFrame} from "./utils/buildFrame";

/**
 * Pinhole camera module
 * Generates rays from screen coordinates using ideal pinhole camera model
 * Depends on ambient module for geometric operations
 */
const pinholeCamera: ModuleDescriptor = {
    id: {
        kind: 'camera',
        name: 'pinhole',
        version: '1.0.0'
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
        // Add random offset xi for antialiasing (Phase 2: xi = vec2(0) for now)
        vec2 ndc = (2.0 * (pixel + xi) / u_resolution) - 1.0;
        
        // Account for aspect ratio - correct x coordinate
        float aspect = u_resolution.x / u_resolution.y;
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
            compute: (params) => params['camera.position']
        },
        {
            uniform: 'u_camera_tan_fov',
            parameters: ['camera.fov'],
            compute: (params) => Math.tan(params['camera.fov'] * Math.PI / 180 / 2)
        },
        {
            uniform: 'u_camera_frame',
            parameters: ['camera.position', 'camera.target'],
            compute: (params) => {
                const frame = buildFrame(params['camera.position'], params['camera.target']);
                return frame;
            }
        }
    ],


    exports: ['camera_generateRay']
};

export { pinholeCamera };
