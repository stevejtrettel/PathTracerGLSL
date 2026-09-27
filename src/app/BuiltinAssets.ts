import type { CompiledRenderer } from '../compiler/types.js';
import type { Engine } from '../engine/Engine.js';
import { BUILTIN_ASSETS } from '../components/assets.js';

/** Retain immutable CPU bytes so a restored WebGL context can upload them again. */
export class BuiltinAssets {
    private data = new Map<string, Float32Array>();

    async upload(renderers: CompiledRenderer[], engine: Pick<Engine, 'registerDataTexture'>): Promise<void> {
        const ids = new Set(renderers.flatMap(r => r.pipeline.passes.flatMap(p =>
            Object.values(p.inputs?.textures ?? {}).filter(ref => ref.startsWith('extern:')).map(ref => ref.slice(7)))));
        for (const id of ids) {
            const asset = BUILTIN_ASSETS.get(id);
            if (!asset) continue; // Scene/environment resources have their own provisioning routes.
            let data = this.data.get(id);
            if (!data) {
                const response = await fetch(asset.url).catch(cause => {
                    throw new Error(`Built-in asset '${id}' failed to load`, { cause });
                });
                if (!response.ok) throw new Error(`Built-in asset '${id}' failed to load: HTTP ${response.status}`);
                const bytes = await response.arrayBuffer();
                if (bytes.byteLength !== asset.width * asset.height * 16)
                    throw new Error(`Built-in asset '${id}' has the wrong byte length`);
                const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
                if (hash !== asset.sha256) throw new Error(`Built-in asset '${id}' checksum mismatch`);
                data = new Float32Array(bytes);
                this.data.set(id, data);
            }
            engine.registerDataTexture(id, data, asset.width, asset.height);
        }
    }
}
