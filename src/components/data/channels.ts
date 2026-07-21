// components/data/channels.ts — the rail v2 CHANNEL ROSTER (fable-data-rail §3).
//
// One RGBA32F texture (one texture unit) per KIND of data, for ALL tenants — texture
// count scales with ROLE count, never tenant count. Tenants are REGIONS (baked base
// offsets from the ledger); ids stored in texels stay tenant-LOCAL, only fetches add
// bases. The roster is deliberately small and FIXED — a new data-driven system claims
// regions in existing channels (records/nodes are the generic homes); adding a channel
// is a design event against the §5 unit budget, not a routine door.

/** The six channels (fable-data-rail §3). */
export const DATA_CHANNELS = ['vertices', 'normals', 'uvs', 'indices', 'nodes', 'records'] as const;
export type DataChannel = (typeof DATA_CHANNELS)[number];

/** Extern name (TextureRegistry key) for a channel. */
export function channelExtern(c: DataChannel): string {
    return `data_${c}`;
}

/** GLSL sampler uniform name for a channel. */
export function channelUniform(c: DataChannel): string {
    return `u_data_${c}`;
}
