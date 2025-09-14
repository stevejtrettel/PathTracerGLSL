import { describe, it, expect } from 'vitest';
import {
    assembleFragment,
    assembleTraceFragment,
    modulePrefix,
    prefixModuleUniforms,
    collectProvided,
    ensureProvides,
    systemPrelude,
    wrapFragment,
} from '../src/engine/shaders/AssemblerLite';
import type { ModuleDescriptorBase } from '../src/core/contracts/Descriptors';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function expectHasUniform(src: string, type: string, name: string) {
    const re = new RegExp(`uniform\\s+${type}\\s+${name}\\s*;`);
    expect(src).toMatch(re);
}

/* -------------------------------------------------------------------------- */
/* Tiny mock modules                                                           */
/* -------------------------------------------------------------------------- */

const CameraPinhole: ModuleDescriptorBase = {
    id: 'camera.pinhole',
    version: '1.0.0',
    provides: [{ name: 'generateRay', stage: 'fragment' }],
    uniforms: [{ name: 'fovY', type: 'float', cadence: 'per_frame' }],
    glsl: `
    uniform float fovY;
    struct Ray { vec3 origin; vec3 dir; };
    Ray generateRay(vec2 v_uv) {
      vec2 ndc = v_uv * 2.0 - 1.0;
      vec3 d = normalize(vec3(ndc * tan(radians(fovY*0.5)), -1.0));
      return Ray(vec3(0.0), d);
    }
  `,
};

const WorldSDFStub: ModuleDescriptorBase = {
    id: 'world.sdf_stub',
    version: '1.0.0',
    provides: [
        { name: 'intersectScene', stage: 'fragment' },
        { name: 'shadeSurface', stage: 'fragment' },
    ],
    uniforms: [{ name: 'sphereRadius', type: 'float', cadence: 'per_frame' }],
    glsl: `
    uniform float sphereRadius;
    struct Ray { vec3 origin; vec3 dir; };
    bool intersectScene(Ray ray, out vec3 p, out vec3 n) {
      p = ray.origin + ray.dir * sphereRadius;
      n = vec3(0.0, 1.0, 0.0);
      return true;
    }
    vec3 shadeSurface(vec3 pos, vec3 n, vec3 wo) {
      return vec3(0.8, 0.2, 0.1);
    }
  `,
};

const TracerFlatColor: ModuleDescriptorBase = {
    id: 'tracer.flat_color',
    version: '1.0.0',
    provides: [{ name: 'tracePixel', stage: 'fragment' }],
    uniforms: [
        { name: 'color', type: 'vec3', cadence: 'per_frame' },
        { name: 'exposureEV', type: 'float', cadence: 'per_frame' },
    ],
    glsl: `
    uniform vec3  color;
    uniform float exposureEV;
    vec4 tracePixel(vec2 v_uv) {
      return vec4(color * exp2(exposureEV), 1.0);
    }
  `,
};

const TracerNeedsWorld: ModuleDescriptorBase = {
    id: 'tracer.oneshot',
    version: '1.0.0',
    provides: [{ name: 'tracePixel', stage: 'fragment' }],
    requires: ['generateRay', 'intersectScene', 'shadeSurface'],
    uniforms: [{ name: 'sunStrength', type: 'float', cadence: 'per_frame' }],
    glsl: `
    struct Ray { vec3 origin; vec3 dir; };
    Ray generateRay(vec2 v_uv);
    bool intersectScene(Ray ray, out vec3 p, out vec3 n);
    vec3 shadeSurface(vec3 pos, vec3 n, vec3 wo);
    uniform float sunStrength;
    vec4 tracePixel(vec2 v_uv) {
      Ray r = generateRay(v_uv);
      vec3 p, n;
      bool hit = intersectScene(r, p, n);
      vec3 c = hit ? shadeSurface(p, n, -r.dir) * sunStrength : vec3(0.0);
      return vec4(c, 1.0);
    }
  `,
};

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('prefixModuleUniforms()', () => {
    it('rewrites declarations and uses with a stable prefix', () => {
        const pref = modulePrefix(CameraPinhole);
        const { glsl, map } = prefixModuleUniforms(CameraPinhole);
        expect(map.get('fovY')).toBe(`${pref}fovY`);
        expect(glsl).toMatch(new RegExp(`uniform\\s+float\\s+${pref}fovY\\s*;`));
        expect(glsl).toContain(`${pref}fovY`);
    });
});

describe('collectProvided()/ensureProvides()', () => {
    it('collects provided symbol names', () => {
        const names = collectProvided([CameraPinhole, WorldSDFStub, TracerFlatColor]);
        expect(names.has('generateRay')).toBe(true);
        expect(names.has('intersectScene')).toBe(true);
        expect(names.has('shadeSurface')).toBe(true);
        expect(names.has('tracePixel')).toBe(true);
    });

    it('throws if a required symbol is missing', () => {
        expect(() => ensureProvides(TracerFlatColor, 'generateRay')).toThrow();
    });
});

describe('assembleFragment()', () => {
    it('injects system prelude and preserves glue', () => {
        const glue = `in vec2 v_uv; out vec4 fragColor; void main(){ fragColor = tracePixel(v_uv); }`;
        const src = assembleFragment([TracerFlatColor], glue);

        expect(src).toContain('g_sys_resolution');
        expectHasUniform(src, 'vec3', 'g_tracer_flat_color_color');
        expect(src).toContain('g_tracer_flat_color_exposureEV');
    });
});

describe('assembleTraceFragment()', () => {
    it('2-arg form: camera + flat tracer assembles and prefixes both', () => {
        const src = assembleTraceFragment(CameraPinhole, TracerFlatColor);
        expectHasUniform(src, 'float', 'g_camera_pinhole_fovY');
        expectHasUniform(src, 'vec3', 'g_tracer_flat_color_color');
    });

    it('3-arg form: camera + world + needs-world tracer assembles', () => {
        const src = assembleTraceFragment(CameraPinhole, WorldSDFStub, TracerNeedsWorld);
        expectHasUniform(src, 'float', 'g_world_sdf_stub_sphereRadius');
        expectHasUniform(src, 'float', 'g_tracer_oneshot_sunStrength');
    });

    it('throws if world requirements are not satisfied in 2-arg form', () => {
        expect(() => assembleTraceFragment(CameraPinhole, TracerNeedsWorld)).toThrow();
    });
});

describe('systemPrelude()/wrapFragment()', () => {
    it('wraps with version/precision and inserts prelude', () => {
        const body = [systemPrelude(), 'void main(){ }'].join('\n');
        const out = wrapFragment(body);
        expect(out.startsWith('#version 300 es')).toBe(true);
        expect(out).toContain('g_sys_resolution');
    });
});
