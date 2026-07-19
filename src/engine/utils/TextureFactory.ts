// engine/utils/TextureFactory.ts

/**
 * TextureFactory - Creates floating-point data textures
 *
 * Focuses on common cases: R32F (CDFs/PDFs) and RGB32F (HDR images)
 * Automatically handles linear filtering fallback if unsupported
 */
export class TextureFactory {
    private gl: WebGL2RenderingContext;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;

        if (!gl.getExtension('EXT_color_buffer_float')) {
            throw new Error('Float textures required but not supported');
        }
    }

    /**
     * Create single-channel float texture
     * Use for: CDFs, PDFs, 1D lookup tables
     */
    createR32F(data: Float32Array, width: number, height: number = 1): WebGLTexture {
        if (data.length !== width * height) {
            throw new Error(`Data size mismatch: expected ${width * height}, got ${data.length}`);
        }

        const texture = this.gl.createTexture();
        if (!texture) throw new Error('Failed to create texture');

        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,
            this.gl.R32F,
            width,
            height,
            0,
            this.gl.RED,
            this.gl.FLOAT,
            data
        );

        // NEAREST, not LINEAR: these are CDF/PDF lookup tables, so exact texel
        // fetches are what the samplers want (interpolating between CDF entries
        // would bias inverse-CDF sampling). NEAREST also needs no float-linear
        // extension — LINEAR on an R32F texture without OES_texture_float_linear
        // makes it incomplete and samples as 0 on some devices.
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        return texture;
    }

    /**
     * Create RGB float texture
     * Use for: HDR environment maps, radiance buffers
     */
    createRGB32F(data: Float32Array, width: number, height: number): WebGLTexture {
        if (data.length !== width * height * 3) {
            throw new Error(`Data size mismatch: expected ${width * height * 3}, got ${data.length}`);
        }

        const texture = this.gl.createTexture();
        if (!texture) throw new Error('Failed to create texture');

        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,
            this.gl.RGB32F,
            width,
            height,
            0,
            this.gl.RGB,
            this.gl.FLOAT,
            data
        );

        // Fallback to nearest filtering if linear not supported
        const linearExt = this.gl.getExtension('OES_texture_float_linear');
        const filterMode = linearExt ? this.gl.LINEAR : this.gl.NEAREST;

        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, filterMode);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, filterMode);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        return texture;
    }

    /**
     * Create RGBA float data texture, NEAREST-filtered for exact texelFetch.
     * Use for: mesh geometry data textures (positions, normals, uv, triangle indices —
     * indices stored as exact float; impl-plan-meshes) and any texelFetch lookup buffer.
     * NEAREST/CLAMP (never LINEAR): these are indexed data buffers, not sampled images —
     * interpolation would corrupt a vertex/index fetch, and NEAREST needs no float-linear ext.
     */
    createRGBA32F(data: Float32Array, width: number, height: number): WebGLTexture {
        if (data.length !== width * height * 4) {
            throw new Error(`Data size mismatch: expected ${width * height * 4}, got ${data.length}`);
        }

        const texture = this.gl.createTexture();
        if (!texture) throw new Error('Failed to create texture');

        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,
            this.gl.RGBA32F,
            width,
            height,
            0,
            this.gl.RGBA,
            this.gl.FLOAT,
            data
        );

        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        return texture;
    }
}
