// Image textures: one layer of the material image array (u_material_textures, RGBA8, all layers
// one size) as a field on the surface chart. The conventions are pbrt-v4's (textures.cpp,
// util/image.h), and the TS twin is tests/glsl/imageTextureTwin.ts:
//   - t = 1 − v, so uv (0, 0) is the image's bottom-left corner (layer row 0 is the file's top row);
//   - texel centers at half-integers: x = s·W − ½, y = t·H − ½;
//   - each texel is decoded to linear BEFORE the bilinear blend (decoding the blend is a
//     different, darker field);
//   - repeat wrap in both directions.
// No mipmaps: the pixel filter integrates the field by supersampling, so the converged pixel is
// the exact integral of the BSDF built from this field. The filter, wrap and decode are done here
// with texelFetch, so they do not depend on sampler state or on the device.

/** The sRGB transfer curve: code value c ∈ [0, 1] → linear. */
float srgb_decode(float c) {
    return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}

/** Texel (i, j) of `layer`, with i ∈ [−1, size.x] and j ∈ [−1, size.y] wrapped into range, and
 *  its color channels decoded when `srgb` (alpha is always linear). */
vec4 image_texel(int layer, ivec2 size, int i, int j, bool srgb) {
    i = i < 0 ? i + size.x : (i >= size.x ? i - size.x : i);
    j = j < 0 ? j + size.y : (j >= size.y ? j - size.y : j);
    vec4 c = texelFetch(u_material_textures, ivec3(i, j, layer), 0);
    return srgb ? vec4(srgb_decode(c.r), srgb_decode(c.g), srgb_decode(c.b), c.a) : c;
}

/** The field at chart point uv: linear values in [0, 1]. */
vec4 image_texture(int layer, vec2 uv, bool srgb) {
    ivec2 size = textureSize(u_material_textures, 0).xy;
    vec2 st = vec2(fract(uv.x), 1.0 - fract(uv.y));
    vec2 xy = st * vec2(size) - 0.5;   // x ∈ [−½, W − ½), y ∈ (−½, H − ½]
    vec2 cell = floor(xy);
    vec2 d = xy - cell;
    ivec2 i0 = ivec2(cell);
    vec4 t00 = image_texel(layer, size, i0.x, i0.y, srgb);
    vec4 t10 = image_texel(layer, size, i0.x + 1, i0.y, srgb);
    vec4 t01 = image_texel(layer, size, i0.x, i0.y + 1, srgb);
    vec4 t11 = image_texel(layer, size, i0.x + 1, i0.y + 1, srgb);
    return mix(mix(t00, t10, d.x), mix(t01, t11, d.x), d.y);
}
