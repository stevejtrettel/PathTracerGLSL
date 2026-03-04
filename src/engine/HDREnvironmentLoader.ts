// engine/HDREnvironmentLoader.ts
// Handles loading and processing of HDR environment maps

import { TextureRegistry } from './TextureRegistry.js';
import { TextureFactory } from './utils/TextureFactory.js';
import { HDRLoader } from './loaders/hdr-loader.js';
import { buildEnvironmentSampler } from './loaders/build-environment-sampler.js';
import {
    validateHDRResponse,
    validateHDRBuffer,
    validateHDRData,
    validateTextureCreation,
    ConsoleReporter,
    type DiagnosticBag,
    EnvironmentLoadError
} from '../errors/index.js';

/**
 * HDR environment data including textures and metadata
 */
export interface HDREnvironmentData {
    /** Width of the environment map */
    width: number;
    /** Height of the environment map */
    height: number;
    /** Total luminance weight (for importance sampling normalization) */
    totalWeight: number;
}

/**
 * HDREnvironmentLoader loads and processes HDR environment maps
 *
 * Responsibilities:
 * - Fetch and parse .hdr files (Radiance RGBE format)
 * - Create GPU textures for the environment map
 * - Build importance sampling CDFs (conditional and marginal)
 * - Register textures in the TextureRegistry
 *
 * After loading, textures are registered with names:
 * - 'env_map': The HDR environment image
 * - 'env_cdf_cond': Conditional CDF for importance sampling
 * - 'env_cdf_marg': Marginal CDF for importance sampling
 */
export class HDREnvironmentLoader {
    private reporter = new ConsoleReporter();
    private gl: WebGL2RenderingContext;
    private textureRegistry: TextureRegistry;

    constructor(gl: WebGL2RenderingContext, textureRegistry: TextureRegistry) {
        this.gl = gl;
        this.textureRegistry = textureRegistry;
    }

    /**
     * Load HDR environment map and build sampling CDFs
     *
     * Loads an HDR file and creates textures for:
     * - env_map: The HDR environment image
     * - env_cdf_cond: Conditional CDF for importance sampling
     * - env_cdf_marg: Marginal CDF for importance sampling
     *
     * Textures are registered in the TextureRegistry and can be bound
     * to shaders using the texture registry's bind() method.
     *
     * @param path - Path to the .hdr file
     * @returns HDR environment data including dimensions and total weight
     */
    async loadEnvironmentHDR(path: string): Promise<HDREnvironmentData> {
        console.log(`Loading HDR environment: ${path}`);

        try {
            // Fetch
            const res = await fetch(path);
            this.throwIfValidationFails(
                validateHDRResponse(res, path),
                `Failed to load HDR from '${path}'.`
            );

            // Get buffer
            const buffer = await res.arrayBuffer();
            this.throwIfValidationFails(
                validateHDRBuffer(buffer, path),
                `Invalid HDR file '${path}'.`
            );

            // Parse
            let hdr;
            try {
                hdr = HDRLoader.parse(buffer);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`\n❌ HDR parsing failed:\n`);
                console.error(`  • ${message}`);
                throw new EnvironmentLoadError(
                    `Failed to parse HDR file '${path}'. File may be corrupted.`,
                    { path, parseError: message }
                );
            }

            const { width, height, data } = hdr;
            this.throwIfValidationFails(
                validateHDRData(width, height, data.length, path),
                `Invalid HDR data in '${path}'.`
            );

            // Create texture
            const tf = new TextureFactory(this.gl);
            const envTex = tf.createRGB32F(data, width, height);
            this.throwIfValidationFails(
                validateTextureCreation(envTex, width, height, this.gl),
                `Failed to create texture for '${path}'.`
            );

            this.textureRegistry.register('env_map', envTex);

            // Build CDF textures for importance sampling
            const built = buildEnvironmentSampler(
                this.gl,
                this.textureRegistry,
                data,
                width,
                height,
                { map: 'env_map', cond: 'env_cdf_cond', marg: 'env_cdf_marg' }
            );

            console.log(`✅ HDR loaded: ${width}×${height} (CDFs built)`);

            return {
                width,
                height,
                totalWeight: built.totalWeight
            };
        } catch (error) {
            if (error instanceof EnvironmentLoadError) {
                throw error;
            }
            throw new EnvironmentLoadError(
                `Failed to load HDR environment from '${path}'`,
                { path, error }
            );
        }
    }

    /**
     * Check validation result and throw if errors found.
     * Logs warnings if present.
     */
    private throwIfValidationFails(result: DiagnosticBag, errorMessage: string): void {
        if (result.hasErrors()) {
            console.error(this.reporter.formatBag(result));
            throw new EnvironmentLoadError(`${errorMessage} See console for details.`);
        }
        if (result.hasWarnings()) {
            console.warn(this.reporter.formatBag(result));
        }
    }
}
