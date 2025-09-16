// src/engine/bindings/resource-binder.ts
/**
 * resource-binder.ts — v1
 * ------------------------------------------------------------
 * PURPOSE
 *   Bind sampler uniforms by logical name:
 *     - asks TextureUnitPool for a unit per logical sampler
 *     - gl.activeTexture(TEXTURE0 + unit) + gl.bindTexture(target, texture)
 *     - sets the int uniform (unit index) via UniformBinder.setMany()
 *     - returns per-call stats
 *
 * NOTES
 *   - This class is intentionally ignorant of shader prefixes; we bind by
 *     logical uniform names that match the compiler manifest.
 *   - Manifest samplers can be either string[] or {logical:string,type:string}[].
 */

import TextureUnitPool from "./texture-unit-pool";
import type { UniformBinderLike } from "../execution/render-engine";

export interface SamplerBinding {
    /** WebGL texture object (null allowed to unbind). */
    texture: WebGLTexture | null;
    /** GL target, e.g., gl.TEXTURE_2D, gl.TEXTURE_CUBE_MAP. */
    target: number;
    /** Pin the logical name to prevent eviction. */
    pin?: boolean;
}

export interface BindResult {
    /** How many logical samplers we attempted to bind (known to manifest). */
    attempted: number;
    /** How many uniforms were reported bound by the UniformBinder. */
    bound: number;
    /** Logical sampler names skipped (unknown to manifest) plus any binder skips. */
    skipped: string[];
    /** Human-friendly error messages (e.g., all units pinned). */
    errors: string[];
}

function extractSamplerSet(manifest: any): Set<string> {
    // Accepts manifest.samplers as either string[] or {logical:string,...}[]
    const s = new Set<string>();
    const arr = manifest?.samplers ?? [];
    for (const it of arr) {
        if (typeof it === "string") s.add(it);
        else if (it && typeof it.logical === "string") s.add(it.logical);
    }
    return s;
}

export default class ResourceBinder {
    private gl: WebGL2RenderingContext;
    private pool: TextureUnitPool;
    private binder: UniformBinderLike;
    private known: Set<string>;
    private attached = new Set<string>(); // logical names we’ve assigned at least once

    constructor(
        gl: WebGL2RenderingContext,
        pool: TextureUnitPool,
        binder: UniformBinderLike,
        manifest: any // tolerant; just needs .samplers
    ) {
        this.gl = gl;
        this.pool = pool;
        this.binder = binder;
        this.known = extractSamplerSet(manifest);
    }

    /**
     * Bind a batch of sampler uniforms by logical name.
     * Unknown logical names are skipped (reported). Errors (e.g., all pinned) are collected.
     */
    bind(resources: Record<string, SamplerBinding>): BindResult {
        const gl = this.gl;

        const unknown: string[] = [];
        const errors: string[] = [];
        const toSet: Array<{ logical: string; value: number; kind?: "int" }> = [];

        for (const [logical, spec] of Object.entries(resources)) {
            if (!this.known.has(logical)) {
                unknown.push(logical);
                continue;
            }

            let unit: number;
            try {
                unit = this.pool.acquire(logical, { pin: !!spec.pin });
            } catch (e: any) {
                errors.push(String(e?.message ?? e));
                continue;
            }

            // Activate + bind (null texture allowed to unbind)
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(spec.target, spec.texture);

            // Prepare setting the sampler uniform to this unit
            toSet.push({ logical, value: unit, kind: "int" });
            this.attached.add(logical);
        }

        // Set uniforms in one go
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
            skipped: [...unknown, ...binderSkipped],
            errors,
        };
    }

    /** Release a logical sampler mapping (unit becomes free for reuse). */
    release(logical: string): void {
        this.pool.release(logical);
        this.attached.delete(logical);
    }

    /** Pin or unpin a logical sampler mapping (does nothing if not assigned yet). */
    pin(logical: string, value: boolean): void {
        if (value) this.pool.pin(logical);
        else this.pool.unpin(logical);
    }

    /** Release all mappings this binder touched (safe for shared pool). */
    reset(): void {
        for (const l of this.attached) this.pool.release(l);
        this.attached.clear();
    }

    /** Query the unit for a logical sampler, if assigned. */
    unitOf(logical: string): number | undefined {
        return this.pool.unitOf(logical);
    }

    /** Debug snapshot of current mapping from the pool. */
    debugState() {
        return this.pool.debugState();
    }
}
