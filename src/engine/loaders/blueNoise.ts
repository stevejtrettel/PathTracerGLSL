// engine/loaders/blueNoise.ts — decode the baked blue-noise tile into a GL texture and
// register it globally as `blue_noise`. A scene-independent resource (unlike env_map,
// which loads per-scene): the display dither and the blue-noise sampler both bind it via
// `extern:blue_noise`. Registered once at Engine construction.

import type { TextureRegistry } from '../TextureRegistry.js';
import { BLUE_NOISE_SIZE, BLUE_NOISE_BASE64 } from '../resources/blueNoise.js';

export function registerBlueNoise(gl: WebGL2RenderingContext, registry: TextureRegistry): void {
    const bin = atob(BLUE_NOISE_BASE64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const tex = gl.createTexture();
    if (!tex) throw new Error('blue-noise: failed to create texture');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);   // RGB8, tightly packed rows (3 bytes/texel)
    // Three independent blue-noise channels (R/G/B) → per-channel decorrelated dither.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, BLUE_NOISE_SIZE, BLUE_NOISE_SIZE, 0, gl.RGB, gl.UNSIGNED_BYTE, bytes);
    // NEAREST + REPEAT: the tile wraps across the screen and each pixel samples its exact
    // texel (no interpolation — interpolating blue noise destroys its spectrum).
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.bindTexture(gl.TEXTURE_2D, null);

    registry.register('blue_noise', tex);
}
