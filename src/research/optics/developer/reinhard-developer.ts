
// optics/developer/reinhard-lite-developer.ts
import type { ModuleDescriptor } from '../../../infrastructure/engine/types';

/**
 * Reinhard global tone mapper, no uniforms.
 * Super robust sanity-check baseline.
 */
const reinhardDeveloper: ModuleDescriptor = {
    id: { kind: 'developer', name: 'reinhard-lite', version: '1.0.0' },

    fragment: {
        constants: `
      const float EXPOSURE_EV = 0.0; // radiance *= 2^EV
    `,
        functions: `
      vec3 safe_color(vec3 c){
        c = max(c, vec3(0.0));
        bvec3 ok = lessThanEqual(abs(c), vec3(1e19));
        if(!(ok.x && ok.y && ok.z)) return vec3(0.0);
        return c;
      }

      vec3 linear_to_srgb(vec3 c){
        vec3 lo = 12.92 * c;
        vec3 hi = 1.055 * pow(max(c, 0.0), vec3(1.0/2.4)) - 0.055;
        bvec3 cutoff = lessThanEqual(c, vec3(0.0031308));
        return mix(hi, lo, vec3(cutoff));
      }

      vec3 tonemap_reinhard(vec3 x){
        return x / (1.0 + x);
      }

      RGB developer_develop(Radiance radiance){
        vec3 r = safe_color(radiance) * exp2(EXPOSURE_EV);
        vec3 tm = tonemap_reinhard(r);
        vec3 outRGB = clamp(linear_to_srgb(tm), 0.0, 1.0);
        return RGB(outRGB);
      }
    `
    },

    // exports: ['developer_develop']  // Disabled: using GLSL compiler validation instead
};

export { reinhardDeveloper };
