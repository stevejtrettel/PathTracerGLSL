// engine/loaders/EnvironmentSamplerBuilder.ts

export interface EnvironmentSamplingData {
    marginalInverse: Float32Array;      // 1D: maps uniform [0,1] → v coordinate
    conditionalInverse: Float32Array;   // 2D: maps uniform [0,1] → u coordinate per row
    marginalPdf: Float32Array;          // 1D: PDF for each row
    conditionalPdf: Float32Array;       // 2D: PDF for each pixel
    width: number;                      // Sampling resolution width
    height: number;                     // Sampling resolution height
    inverseResolution: number;          // Resolution of inverse lookup tables
}

/**
 * Builds importance sampling data for HDR environment maps.
 *
 * This creates inverse CDF lookup tables that allow direct sampling:
 * - Sample uniform xi in [0,1]
 * - Look up in inverse CDF texture → get UV coordinate
 * - No binary search needed!
 */
export class EnvironmentSamplerBuilder {
    private samplingWidth: number;
    private samplingHeight: number;
    private inverseResolution: number;

    constructor(
        samplingWidth: number = 256,    // Resolution for building CDFs
        samplingHeight: number = 128,   // (downsampled from full HDR)
        inverseResolution: number = 256 // Resolution of inverse lookup tables
    ) {
        this.samplingWidth = samplingWidth;
        this.samplingHeight = samplingHeight;
        this.inverseResolution = inverseResolution;
    }

    /**
     * Build importance sampling data from HDR
     */
    build(hdr: { width: number; height: number; data: Float32Array }): EnvironmentSamplingData {
        console.log(`Building importance sampling: ${this.samplingWidth}x${this.samplingHeight}`);

        // Step 1: Downsample HDR to sampling resolution
        const downsampled = this.downsample(hdr);

        // Step 2: Convert to luminance with sin(theta) weighting for spherical projection
        const luminance = this.computeLuminance(downsampled);

        // Step 3: Build marginal inverse CDF and PDF (for selecting v/theta)
        const marginalData = this.buildMarginalInverse(luminance);

        // Step 4: Build conditional inverse CDFs and PDFs (for selecting u/phi given v)
        const conditionalData = this.buildConditionalInverse(luminance);

        return {
            marginalInverse: marginalData.inverse,
            marginalPdf: marginalData.pdf,
            conditionalInverse: conditionalData.inverse,
            conditionalPdf: conditionalData.pdf,
            width: this.samplingWidth,
            height: this.samplingHeight,
            inverseResolution: this.inverseResolution
        };
    }

    /**
     * Downsample HDR to sampling resolution with area averaging
     */
    private downsample(hdr: { width: number; height: number; data: Float32Array }): Float32Array {
        const srcW = hdr.width;
        const srcH = hdr.height;
        const dstW = this.samplingWidth;
        const dstH = this.samplingHeight;

        const result = new Float32Array(dstW * dstH * 3);

        // Scale factors
        const scaleX = srcW / dstW;
        const scaleY = srcH / dstH;

        for (let dy = 0; dy < dstH; dy++) {
            for (let dx = 0; dx < dstW; dx++) {
                // Source pixel bounds for this destination pixel
                const sx0 = Math.floor(dx * scaleX);
                const sx1 = Math.min(Math.ceil((dx + 1) * scaleX), srcW);
                const sy0 = Math.floor(dy * scaleY);
                const sy1 = Math.min(Math.ceil((dy + 1) * scaleY), srcH);

                let r = 0, g = 0, b = 0;
                let count = 0;

                // Average all source pixels in this region
                for (let sy = sy0; sy < sy1; sy++) {
                    for (let sx = sx0; sx < sx1; sx++) {
                        const idx = (sy * srcW + sx) * 3;
                        r += hdr.data[idx];
                        g += hdr.data[idx + 1];
                        b += hdr.data[idx + 2];
                        count++;
                    }
                }

                // Store averaged result
                const dstIdx = (dy * dstW + dx) * 3;
                result[dstIdx] = r / count;
                result[dstIdx + 1] = g / count;
                result[dstIdx + 2] = b / count;
            }
        }

        return result;
    }

    /**
     * Convert RGB to luminance with sin(theta) weighting for spherical projection
     */
    private computeLuminance(rgb: Float32Array): Float32Array {
        const w = this.samplingWidth;
        const h = this.samplingHeight;
        const luminance = new Float32Array(w * h);

        for (let y = 0; y < h; y++) {
            // Theta angle for this row (0 to π)
            const theta = (y + 0.5) / h * Math.PI;
            const sinTheta = Math.sin(theta);

            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                const rgbIdx = idx * 3;

                // Rec. 709 luminance
                const lum = 0.2126 * rgb[rgbIdx] +
                    0.7152 * rgb[rgbIdx + 1] +
                    0.0722 * rgb[rgbIdx + 2];

                // Weight by sin(theta) for proper spherical sampling
                luminance[idx] = lum * sinTheta;
            }
        }

        return luminance;
    }

    /**
     * Build marginal inverse CDF for sampling v (theta)
     * Returns a 1D texture that maps uniform [0,1] → v coordinate
     */
    private buildMarginalInverse(luminance: Float32Array): {
        inverse: Float32Array;
        pdf: Float32Array;
    } {
        const w = this.samplingWidth;
        const h = this.samplingHeight;

        // Step 1: Sum each row to build marginal distribution
        const rowSums = new Float32Array(h);
        for (let y = 0; y < h; y++) {
            let sum = 0;
            for (let x = 0; x < w; x++) {
                sum += luminance[y * w + x];
            }
            rowSums[y] = sum;
        }

        // Step 2: Build CDF from row sums
        const cdf = new Float32Array(h + 1);
        cdf[0] = 0;
        for (let y = 0; y < h; y++) {
            cdf[y + 1] = cdf[y] + rowSums[y];
        }

        // Normalize CDF to [0, 1]
        const total = cdf[h];
        if (total > 0) {
            for (let i = 0; i <= h; i++) {
                cdf[i] /= total;
            }
        }

        // Step 3: Build inverse CDF by sampling it uniformly
        const inverse = new Float32Array(this.inverseResolution);

        for (let i = 0; i < this.inverseResolution; i++) {
            const xi = i / (this.inverseResolution - 1);

            // Find where xi falls in the CDF
            let v = 0;
            for (let y = 1; y <= h; y++) {
                if (xi <= cdf[y]) {
                    // Linear interpolation between CDF values
                    const t = (xi - cdf[y - 1]) / Math.max(0.00001, cdf[y] - cdf[y - 1]);
                    v = (y - 1 + t) / h;  // Normalize to [0, 1]
                    break;
                }
            }

            inverse[i] = v;
        }

        // Step 4: Store normalized PDF values (probability per unit area)
        const pdf = new Float32Array(h);
        for (let y = 0; y < h; y++) {
            // PDF is the difference in CDF values, scaled by height
            pdf[y] = (cdf[y + 1] - cdf[y]) * h;
        }

        return { inverse, pdf };
    }

    /**
     * Build conditional inverse CDFs for sampling u (phi) given v
     * Returns a 2D texture where each row is an inverse CDF
     */
    private buildConditionalInverse(luminance: Float32Array): {
        inverse: Float32Array;
        pdf: Float32Array;
    } {
        const w = this.samplingWidth;
        const h = this.samplingHeight;
        const invRes = this.inverseResolution;

        // We'll build one inverse CDF per row
        const inverse = new Float32Array(h * invRes);
        // Store PDF for each pixel
        const pdf = new Float32Array(h * w);

        for (let y = 0; y < h; y++) {
            // Step 1: Build CDF for this row
            const cdf = new Float32Array(w + 1);
            cdf[0] = 0;

            for (let x = 0; x < w; x++) {
                cdf[x + 1] = cdf[x] + luminance[y * w + x];
            }

            // Normalize this row's CDF
            const rowTotal = cdf[w];
            if (rowTotal > 0) {
                for (let x = 0; x <= w; x++) {
                    cdf[x] /= rowTotal;
                }
            }

            // Step 2: Build inverse CDF for this row
            for (let i = 0; i < invRes; i++) {
                const xi = i / (invRes - 1);

                // Find where xi falls in this row's CDF
                let u = 0;
                for (let x = 1; x <= w; x++) {
                    if (xi <= cdf[x]) {
                        const t = (xi - cdf[x - 1]) / Math.max(0.00001, cdf[x] - cdf[x - 1]);
                        u = (x - 1 + t) / w;  // Normalize to [0, 1]
                        break;
                    }
                }

                inverse[y * invRes + i] = u;
            }

            // Step 3: Store normalized PDF for this row
            for (let x = 0; x < w; x++) {
                // PDF is the difference in CDF values, scaled by width
                pdf[y * w + x] = (cdf[x + 1] - cdf[x]) * w;
            }
        }

        return { inverse, pdf };
    }
}
