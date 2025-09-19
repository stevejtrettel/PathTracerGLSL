/**
 * resource-binder.ts — v1.3 (sampler arrays + optional dummy fallback)
 * ------------------------------------------------------------
 * PURPOSE
 *   Bind sampler uniforms by logical name:
 *     - asks TextureUnitPool for a unit per *logical element* (see below)
 *     - gl.activeTexture(TEXTURE0 + unit) + gl.bindTexture(target, textureOrFallback)
 *     - sets the int uniform via UniformBinder.setMany()
 *     - returns per-call stats
 *
 * SAMPLER ARRAYS
 *   For manifest entries like `uniform sampler2D lut[4];`, the app supplies
 *   resources using bracketed keys: "lut[0]", "lut[1]". Missing indices are skipped.
 *
 * FALLBACKS
 *   Optional `opts.getFallback(target)` provides a dummy texture when resource.texture
 *   is null. If no fallback is provided, we bind `null` (GL-safe, returns 0s only if
 *   your shader guards against sampling).
 */

import TextureUnitPool from "./texture-unit-pool";

// Tiny surface from UniformBinder to avoid cross-layer imports.
export interface UniformBinderLike {
    setMany(items: Array<{ logical: string; value: number; kind?: "int" }>): { bound: number; skipped: string[] };
}

export interface SamplerBinding {
    texture: WebGLTexture | null;
    target: number; // e.g., gl.TEXTURE_2D, gl.TEXTURE_CUBE_MAP, gl.TEXTURE_2D_ARRAY
    pin?: boolean;
}

export interface BindResult {
    attempted: number;
    bound: number;
    skipped: string[]; // unknown logicals or uniforms optimized out
    errors: string[];  // human friendly error messages
}

type ManifestSampler = {
    logical: string;
    namespaced: string;
    type: string;
    arraySize?: number;
};

function extractSamplers(manifest: any): ManifestSampler[] {
    const arr = manifest?.samplers ?? [];
    if (Array.isArray(arr) && arr.length && typeof arr[0] === "string") {
        // legacy manifest support (string[])
        return (arr as string[]).map((logical) => ({ logical, namespaced: logical, type: "sampler2D" }));
    }
    return arr as ManifestSampler[];
}

function parseBracketed(name: string): { base: string; index: number } | null {
    const m = /^([A-Za-z_]\w*)\[(\d+)\]$/.exec(name);
    if (!m) return null;
    return { base: m[1]!, index: parseInt(m[2]!, 10) | 0 };
}

export interface ResourceBinderOptions {
    /** Provide a dummy texture for the given GL target (if the app set texture:null). */
    getFallback?: (target: number) => WebGLTexture | null;
}

export default class ResourceBinder {
    private gl: WebGL2RenderingContext;
    private pool: TextureUnitPool;
    private binder: UniformBinderLike;
    private samplers: ManifestSampler[];
    private opts: ResourceBinderOptions;

    // Track element-level attachments (e.g., "set[3]") for safe reset()
    private attached = new Set<string>();

    constructor(
        gl: WebGL2RenderingContext,
        pool: TextureUnitPool,
        binder: UniformBinderLike,
        manifest: any, // tolerant; just needs .samplers
        opts: ResourceBinderOptions = {}
    ) {
        this.gl = gl;
        this.pool = pool;
        this.binder = binder;
        this.samplers = extractSamplers(manifest);
        this.opts = opts;
    }

    bind(resources: Record<string, SamplerBinding>): BindResult {
        const gl = this.gl;

        const errors: string[] = [];
        const toSet: Array<{ logical: string; value: number; kind?: "int" }> = [];

        // 1) Bind everything declared in the manifest (arrays + singles)
        for (const s of this.samplers) {
            if (typeof s.arraySize === "number" && s.arraySize > 0) {
                for (let i = 0; i < s.arraySize; i++) {
                    const key = `${s.logical}[${i}]`;
                    const spec = resources[key];
                    if (!spec) continue;

                    let unit: number;
                    try {
                        unit = this.pool.acquire(key, { pin: !!spec.pin });
                    } catch (e: any) {
                        errors.push(String(e?.message ?? e));
                        continue;
                    }

                    const tex = spec.texture ?? this.opts.getFallback?.(spec.target) ?? null;
                    gl.activeTexture(gl.TEXTURE0 + unit);
                    gl.bindTexture(spec.target, tex);

                    toSet.push({ logical: key, value: unit, kind: "int" });
                    this.attached.add(key);
                }
            } else {
                const spec = resources[s.logical];
                if (!spec) continue;

                let unit: number;
                try {
                    unit = this.pool.acquire(s.logical, { pin: !!spec.pin });
                } catch (e: any) {
                    errors.push(String(e?.message ?? e));
                    continue;
                }

                const tex = spec.texture ?? this.opts.getFallback?.(spec.target) ?? null;
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(spec.target, tex);

                toSet.push({ logical: s.logical, value: unit, kind: "int" });
                this.attached.add(s.logical);
            }
        }

        // 2) Report resource keys that don't correspond to declared sampler uniforms
        const declared = new Set<string>();
        for (const s of this.samplers) {
            if (typeof s.arraySize === "number" && s.arraySize > 0) {
                for (let i = 0; i < s.arraySize; i++) declared.add(`${s.logical}[${i}]`);
            } else {
                declared.add(s.logical);
            }
        }

        const unknownResourceKeys = Object.keys(resources).filter((k) => {
            const elem = parseBracketed(k);
            if (!elem) return !declared.has(k);
            // if base is array, declared includes in-range elements; otherwise it's unknown
            return !declared.has(k);
        });

        // 3) Set uniforms via UniformBinder
        let bound = 0;
        let binderSkipped: string[] = [];
        if (toSet.length > 0) {
            const res = this.binder.setMany(toSet);
            bound = res.bound ?? 0;
            binderSkipped = res.skipped ?? [];
        }

        return {
            attempted: toSet.length,
            bound,
            skipped: [...unknownResourceKeys, ...binderSkipped],
            errors,
        };
    }

    release(logical: string): void {
        this.pool.release(logical);
        this.attached.delete(logical);
    }

    pin(logical: string, value: boolean): void {
        if (value) this.pool.pin(logical);
        else this.pool.unpin(logical);
    }

    reset(): void {
        for (const l of this.attached) this.pool.release(l);
        this.attached.clear();
    }

    unitOf(logical: string): number | undefined {
        return this.pool.unitOf(logical);
    }

    debugState() {
        return this.pool.debugState();
    }
}
