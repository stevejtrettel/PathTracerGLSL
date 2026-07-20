// glsl/core/data_texture.glsl — data-texture addressing (the rail's GLSL half).
// Included whenever a program reads data textures (mesh geometry, instance placements,
// BVH nodes). DATA_TEX_WIDTH is emitted by the compiler from components/data_textures.ts
// — the ONE width both the app's packers and this addressing share.

// Linear texel index → 2D coordinate (data textures are row-major at the fixed width).
ivec2 data_texel1d(uint i) {
    return ivec2(int(i % uint(DATA_TEX_WIDTH)), int(i / uint(DATA_TEX_WIDTH)));
}
