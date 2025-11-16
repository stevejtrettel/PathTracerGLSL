// objects/environment/hdri-environment-importance.ts
import type { ModuleDescriptor } from '../../engine/types.js';

/**
 * HDRI Environment with binary-search importance sampling (CDFs).
 *
 * Inputs (set at HDR load time via buildEnvironmentSampler and engine):
 *  - u_env_map               : RGB32F HDR env texture (engine binds)
 *  - u_env_cdf_conditional   : R32F W×H (per-row conditional CDF, NEAREST)
 *  - u_env_cdf_marginal      : R32F 1×H (marginal CDF over rows, NEAREST)
 *  - u_env_size              : vec2(W, H)   <-- floats (TS-friendly)
 *  - u_env_totalWeight       : sum_{i,j} luminance(i,j) * sin(theta_j)
 *  - u_env_intensity         : scalar exposure multiplier
 *  - u_env_rotation          : rotation in radians (yaw)
 *
 * Exports:
 *  - environment_radiance(direction) : vec3
 *  - environment_sample(Point p)     : LightSample (wi, distance, position, radiance, pdf)
 *  - environment_pdf(direction)      : float (PDF over solid angle)
 */
const hdriEnvironmentImportance: ModuleDescriptor = {
    id: {
        kind: 'environment',
        name: 'hdri-importance',
        version: '1.0.0',
    },

    fragment: {
        uniforms: `
      // --- Inputs ---
      uniform sampler2D u_env_map;             // HDR map (RGB32F), filtered
      uniform float     u_env_intensity;       // exposure multiplier
      uniform float     u_env_rotation;        // radians, yaw around +Y

      // Importance-sampling tables (NEAREST access, built on CPU)
      uniform sampler2D u_env_cdf_conditional; // R32F, size W×H
      uniform sampler2D u_env_cdf_marginal;    // R32F, size 1×H
      uniform vec2      u_env_size;            // (W, H) as floats (TS-friendly)
      uniform float     u_env_totalWeight;     // Σ luminance * sinθ (all texels)
    `,

        constants: `
      #define PI      3.14159265359
      #define TWO_PI  6.28318530718
      // Rec.709 luminance weights (same as CPU side)
      const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    `,

        functions: `
      // ===========================
      // Equirectangular mapping
      // ===========================
      // dir -> (u,v) in [0,1]^2 with yaw rotation about Y
      // u = (phi + pi) / (2pi), v = theta / pi
      vec2 direction_to_equirect(vec3 dir) {
        vec3 n = normalize(dir);
        float phi   = atan(n.z, n.x) + u_env_rotation; // [-pi,pi] + rotation
        float theta = acos(clamp(n.y, -1.0, 1.0));     // [0,pi]
        float u = phi * (1.0 / TWO_PI) + 0.5;
        float v = theta * (1.0 / PI);
        return vec2(u, v);
      }

      // (u,v) -> dir on unit sphere with same yaw rotation
      vec3 equirect_to_direction(vec2 uv) {
        float phi   = (uv.x - 0.5) * TWO_PI + u_env_rotation;
        float theta = uv.y * PI;
        float s = sin(theta), c = cos(theta);
        return normalize(vec3(cos(phi) * s, c, sin(phi) * s));
      }

      // ===========================
      // Environment evaluation
      // ===========================
      // Filtered lookup is fine for evaluation; intensity multiplies radiance.
      vec3 environment_radiance(vec3 direction) {
        vec2 uv = direction_to_equirect(direction);
        vec3 rgb = texture(u_env_map, uv).rgb;
        return rgb * u_env_intensity;
      }

      // ===========================
      // Helpers (W,H as ints)
      // ===========================
      int envW() { return int(u_env_size.x + 0.5); }
      int envH() { return int(u_env_size.y + 0.5); }

      // ===========================
      // CDF fetch helpers (NEAREST)
      // ===========================
      float cdf_marg(int j)       { return texelFetch(u_env_cdf_marginal,    ivec2(0, j), 0).r; }
      float cdf_cond(int j, int i){ return texelFetch(u_env_cdf_conditional, ivec2(i, j), 0).r; }
      vec3  texRGB(int i, int j)  { return texelFetch(u_env_map,             ivec2(i, j), 0).rgb; }

      // ===========================
      // Binary searches on CDFs
      // ===========================
      int find_row(float u) {
        int H = envH();
        int lo = 0, hi = H - 1;
        // standard lower_bound over marginal CDF in [0,1]
        while (lo < hi) {
          int mid = (lo + hi) >> 1;
          float c = cdf_marg(mid);
          if (u > c) lo = mid + 1; else hi = mid;
        }
        return lo;
      }

      int find_col(int j, float u) {
        int W = envW();
        int lo = 0, hi = W - 1;
        // lower_bound over conditional CDF for row j
        while (lo < hi) {
          int mid = (lo + hi) >> 1;
          float c = cdf_cond(j, mid);
          if (u > c) lo = mid + 1; else hi = mid;
        }
        return lo;
      }

      // ===========================
      // Solid-angle PDF at texel center
      // ===========================
      // Discrete importance weights used on CPU:
      //   w_ij = luminance(i,j) * sin(theta_j)
      // Each texel covers approx. Δω_ij = (2π/W) * (π/H) * sin(theta_j)
      // So PDF over solid angle inside texel ≈ (w_ij / Σw) / Δω_ij
      float env_pdf_texel(int i, int j) {
        int W = envW(), H = envH();

        // polar angle of row center
        float theta = PI * (float(j) + 0.5) / float(H);
        float sinT  = max(1e-6, sin(theta)); // guard near poles

        // radiance at texel center; intensity multiplies brightness
        vec3  rgb   = texRGB(i, j) * u_env_intensity;
        float Y     = max(0.0, dot(rgb, LUMA));

        float dOmega = (2.0*PI/float(W)) * (PI/float(H)) * sinT;
        float w_ij   = Y * sinT;

        return (u_env_totalWeight > 0.0) ? (w_ij / u_env_totalWeight) / dOmega : 0.0;
      }

      // Continuous PDF for an arbitrary direction:
      // map dir -> nearest texel (i,j) and reuse the texel PDF.
      float environment_pdf(vec3 direction) {
        vec2 uv = direction_to_equirect(direction);
        int W = envW(), H = envH();
        int i = int(clamp(floor(uv.x * float(W)), 0.0, float(W - 1)));
        int j = int(clamp(floor(uv.y * float(H)), 0.0, float(H - 1)));
        return env_pdf_texel(i, j);
      }

      // ===========================
      // Importance sample "as a light"
      // ===========================
      // Returns a LightSample with:
      //   wi        : sampled sky direction
      //   position  : fictitious point far away along wi (for struct parity)
      //   distance  : large number (not actually used for env visibility)
      //   radiance  : env radiance at sampled (u,v) times intensity
      //   pdf       : solid-angle pdf for wi
      LightSample environment_sample(Point p) {
        LightSample ls;

        // 1) draw two uniforms in [0,1)
        vec2 xi = random2();

        // 2) pick row via marginal CDF
        int j = find_row(xi.x);

        // 3) pick column via this row's conditional CDF
        int i = find_col(j, xi.y);

        // 4) jitter inside the chosen texel for continuity
        int W = envW(), H = envH();
        float u = (float(i) + fract(xi.x * float(W))) / float(W);
        float v = (float(j) + fract(xi.y * float(H))) / float(H);

        vec3 dir = equirect_to_direction(vec2(u, v));

        // 5) fill LightSample (match your finite lights' contract)
        ls.wi       = dir;
        ls.position = p + dir * 1e6; // pretend point at infinity
        ls.distance = 1e6;
        ls.radiance = texture(u_env_map, vec2(u, v)).rgb * u_env_intensity;
        ls.pdf      = env_pdf_texel(i, j);

        return ls;
      }
    `,
    },

    uniformBindings: [
        // scalar uniforms
        {
            uniform: 'u_env_intensity',
            parameters: ['environment.intensity'],
            type: 'float',
            compute: (params: Record<string, unknown>) =>
                (params['environment.intensity'] as number) ?? 1.0,
        },
        {
            uniform: 'u_env_rotation',
            parameters: ['environment.rotation'],
            type: 'float',
            compute: (params: Record<string, unknown>) => {
                const deg = (params['environment.rotation'] as number) ?? 0.0;
                return deg * Math.PI / 180.0;
            },
        },

        // textures (sampler2D)
        {
            uniform: 'u_env_cdf_conditional',
            parameters: ['environment.cdf.conditional'],
            type: 'sampler2D',
            compute: (params: Record<string, unknown>) =>
                params['environment.cdf.conditional'] as WebGLTexture,
        },
        {
            uniform: 'u_env_cdf_marginal',
            parameters: ['environment.cdf.marginal'],
            type: 'sampler2D',
            compute: (params: Record<string, unknown>) =>
                params['environment.cdf.marginal'] as WebGLTexture,
        },

        // size and total weight
        {
            uniform: 'u_env_size',
            parameters: ['environment.size'], // [W, H]
            type: 'vec2',
            compute: (params: Record<string, unknown>) => {
                const sz = params['environment.size'] as [number, number];
                return sz ?? [0, 0];
            },
        },
        {
            uniform: 'u_env_totalWeight',
            parameters: ['environment.totalWeight'],
            type: 'float',
            compute: (params: Record<string, unknown>) =>
                (params['environment.totalWeight'] as number) ?? 0.0,
        },

        // NOTE: we do NOT bind u_env_map here; the engine binds it in loadEnvironmentHDR().
    ],

    // exports: ['environment_radiance', 'environment_sample', 'environment_pdf'],  // Disabled: using GLSL compiler validation instead
};

export { hdriEnvironmentImportance };
