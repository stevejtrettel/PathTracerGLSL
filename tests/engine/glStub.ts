// Minimal WebGL2 stub for pure-ish helpers that construct a TextureFactory but whose
// logic-under-test runs on the CPU. Methods are no-ops; unknown property reads (GL
// constants) return 0; getExtension returns a truthy object so float textures "exist".
export function glStub(): WebGL2RenderingContext {
    const impl: Record<string, unknown> = {
        getExtension: () => ({}),
        createTexture: () => ({}),
        bindTexture: () => {},
        texImage2D: () => {},
        texParameteri: () => {},
    };
    return new Proxy(impl, {
        get(target, prop: string) {
            if (prop in target) return target[prop];
            return 0; // any GL constant
        },
    }) as unknown as WebGL2RenderingContext;
}
