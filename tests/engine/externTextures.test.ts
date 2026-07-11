// env-as-light T1: the `extern:` texture chain at the engine seam (§2.10).
// The executor is the sole texture-unit authority: framebuffer refs and extern: refs bind
// to sequential units per pass; a missing extern is a HARD named error, never a silent
// unit-0 sample. The registry is a dumb name → texture store.

import { describe, it, expect } from 'vitest';
import { RenderExecutor } from '../../src/engine/RenderExecutor.js';
import { TextureRegistry } from '../../src/engine/TextureRegistry.js';
import type { ResourceManager } from '../../src/engine/ResourceManager.js';

/** Recording GL stub: captures activeTexture/bindTexture/uniform1i/getUniformLocation calls. */
function recordingGl() {
    const calls: Array<[string, ...unknown[]]> = [];
    const impl: Record<string, unknown> = {
        activeTexture: (unit: number) => calls.push(['activeTexture', unit]),
        bindTexture: (_t: number, tex: unknown) => calls.push(['bindTexture', tex]),
        uniform1i: (loc: unknown, unit: number) => calls.push(['uniform1i', loc, unit]),
        getUniformLocation: (_p: unknown, name: string) => {
            calls.push(['getUniformLocation', name]);
            return { name };   // truthy location object
        },
        deleteTexture: (tex: unknown) => calls.push(['deleteTexture', tex]),
        TEXTURE0: 33984,
        TEXTURE_2D: 3553,
    };
    const gl = new Proxy(impl, {
        get(target, prop: string) {
            if (prop in target) return target[prop];
            return 0;
        },
    }) as unknown as WebGL2RenderingContext;
    return { gl, calls };
}

function fakeResourceManager(map: Record<string, unknown>) {
    return {
        getTexture: (id: string) => {
            if (!(id in map)) throw new Error(`Resource not found: ${id}`);
            return map[id];
        },
    } as unknown as ResourceManager;
}

const program = {} as WebGLProgram;
const bind = (ex: RenderExecutor, textures: Record<string, string>) =>
    (ex as unknown as { _bindTextures(p: WebGLProgram, t: Record<string, string>): void })
        ._bindTextures(program, textures);

describe('extern: texture resolution (T1)', () => {
    it('binds framebuffer refs and extern refs to sequential units in declaration order', () => {
        const { gl, calls } = recordingGl();
        const registry = new TextureRegistry(gl);
        const fbTex = { id: 'fb' }, envTex = { id: 'env' };
        registry.register('env_map', envTex as WebGLTexture);
        const ex = new RenderExecutor(gl, fakeResourceManager({ accumulation_previous: fbTex }), registry);

        bind(ex, { u_previous: 'accumulation_previous', u_envMap: 'extern:env_map' });

        const units = calls.filter(c => c[0] === 'activeTexture').map(c => c[1]);
        expect(units).toEqual([33984 + 0, 33984 + 1]);          // sequential from 0
        const bound = calls.filter(c => c[0] === 'bindTexture').map(c => c[1]);
        expect(bound).toEqual([fbTex, envTex]);                 // declaration order
        const samplers = calls.filter(c => c[0] === 'uniform1i').map(c => c[2]);
        expect(samplers).toEqual([0, 1]);
    });

    it('throws a hard, NAMED error for a missing extern (never a silent unit-0 sample)', () => {
        const { gl } = recordingGl();
        const registry = new TextureRegistry(gl);
        registry.register('other_tex', {} as WebGLTexture);
        const ex = new RenderExecutor(gl, fakeResourceManager({}), registry);

        expect(() => bind(ex, { u_envMap: 'extern:env_map' }))
            .toThrowError(/Extern texture 'env_map'.*u_envMap.*not registered.*other_tex/s);
    });

    it('caches getUniformLocation per (program, name) across passes', () => {
        const { gl, calls } = recordingGl();
        const registry = new TextureRegistry(gl);
        registry.register('env_map', {} as WebGLTexture);
        const ex = new RenderExecutor(gl, fakeResourceManager({}), registry);

        bind(ex, { u_envMap: 'extern:env_map' });
        bind(ex, { u_envMap: 'extern:env_map' });   // second frame

        const lookups = calls.filter(c => c[0] === 'getUniformLocation');
        expect(lookups).toHaveLength(1);            // one GL round-trip, not one per frame
    });
});

describe('TextureRegistry (demoted to a dumb store)', () => {
    it('registers, replaces (deleting the old texture), and reports names', () => {
        const { gl, calls } = recordingGl();
        const registry = new TextureRegistry(gl);
        const a = { v: 1 }, b = { v: 2 };
        registry.register('env_map', a as WebGLTexture);
        registry.register('env_map', b as WebGLTexture);   // replace
        expect(calls.filter(c => c[0] === 'deleteTexture').map(c => c[1])).toEqual([a]);
        expect(registry.get('env_map')).toBe(b);
        expect(registry.has('env_map')).toBe(true);
        expect(registry.names()).toEqual(['env_map']);
    });

    it('drops everything on context loss without deleting dead handles', () => {
        const { gl, calls } = recordingGl();
        const registry = new TextureRegistry(gl);
        registry.register('env_map', {} as WebGLTexture);
        registry.handleContextLoss();
        expect(registry.has('env_map')).toBe(false);
        expect(calls.filter(c => c[0] === 'deleteTexture')).toHaveLength(0);
    });
});
