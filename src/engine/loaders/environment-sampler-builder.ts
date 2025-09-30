// engine/loaders/environment-sampler-builder.ts

export interface EnvironmentSamplingData {
    marginal: Float32Array;       // height + 1 entries
    conditional: Float32Array;    // height × (width + 1) entries
    width: number;                // Sampling resolution width
    height: number;               // Sampling resolution height
    averageLuminance: number;     // For validation/debugging
}

export class EnvironmentSamplerBuilder {
    constructor(
        private samplingWidth: number = 256,
        private samplingHeight: number = 128
    ) {}

    build(hdr: { width: number; height: number; data: Float32Array }): EnvironmentSamplingData {
        // Step 1: Downsample to sampling resolution
        const downsampled = this.downsample(hdr);

        // Step 2: Convert to luminance with sin(theta) weighting
        const luminance = this.computeWeightedLuminance(downsampled);

        // Step 3: Build marginal CDF (for selecting theta)
        const marginal = this.buildMarginalCDF(luminance);

        // Step 4: Build conditional CDFs (for selecting phi given theta)
        const conditional = this.buildConditionalCDFs(luminance);

        // Step 5: Compute average for validation
        const averageLuminance = this.computeAverageLuminance(luminance);

        return {
            marginal,
            conditional,
            width: this.samplingWidth,
            height: this.samplingHeight,
            averageLuminance
        };
    }

    private downsample(hdr: { width: number; height: number; data: Float32Array }): Float32Array {
        const { width: srcW, height: srcH, data: src } = hdr;
        const dstW = this.samplingWidth;
        const dstH = this.samplingHeight;
        const dst = new Float32Array(dstW * dstH * 3);

        const scaleX = srcW / dstW;
        const scaleY = srcH / dstH;

        for (let dy = 0; dy < dstH; dy++) {
            // Compute theta range for this destination row
            const theta0 = (dy * scaleY / srcH) * Math.PI;
            const theta1 = ((dy + 1) * scaleY / srcH) * Math.PI;
            const thetaMid = (theta0 + theta1) / 2;

            for (let dx = 0; dx < dstW; dx++) {
                // Source pixel bounds
                const sx0 = Math.floor(dx * scaleX);
                const sx1 = Math.min(Math.ceil((dx + 1) * scaleX), srcW);
                const sy0 = Math.floor(dy * scaleY);
                const sy1 = Math.min(Math.ceil((dy + 1) * scaleY), srcH);

                let r = 0, g = 0, b = 0;
                let weightSum = 0;

                // Average all source pixels in this region
                for (let sy = sy0; sy < sy1; sy++) {
                    const srcTheta = (sy + 0.5) / srcH * Math.PI;
                    const weight = Math.sin(srcTheta);

                    for (let sx = sx0; sx < sx1; sx++) {
                        const idx = (sy * srcW + sx) * 3;
                        r += src[idx] * weight;
                        g += src[idx + 1] * weight;
                        b += src[idx + 2] * weight;
                        weightSum += weight;
                    }
                }

                // Store averaged result
                if (weightSum > 0) {
                    const dstIdx = (dy * dstW + dx) * 3;
                    dst[dstIdx] = r / weightSum;
                    dst[dstIdx + 1] = g / weightSum;
                    dst[dstIdx + 2] = b / weightSum;
                }
            }
        }

        return dst;
    }

    private computeWeightedLuminance(data: Float32Array): Float32Array {
        const { samplingWidth: w, samplingHeight: h } = this;
        const luminance = new Float32Array(w * h);

        for (let y = 0; y < h; y++) {
            const theta = (y + 0.5) / h * Math.PI;
            const sinTheta = Math.sin(theta);

            for (let x = 0; x < w; x++) {
                const idx = y * w + x;
                const rgbIdx = idx * 3;

                // Compute luminance (Rec. 709 coefficients)
                const lum = 0.2126 * data[rgbIdx] +
                    0.7152 * data[rgbIdx + 1] +
                    0.0722 * data[rgbIdx + 2];

                // Weight by sin(theta) for proper spherical sampling
                luminance[idx] = lum * sinTheta;
            }
        }

        return luminance;
    }

    private buildMarginalCDF(luminance: Float32Array): Float32Array {
        const { samplingWidth: w, samplingHeight: h } = this;
        const marginal = new Float32Array(h + 1);

        // First, compute the sum for each row
        marginal[0] = 0;
        for (let y = 0; y < h; y++) {
            let rowSum = 0;
            for (let x = 0; x < w; x++) {
                rowSum += luminance[y * w + x];
            }
            marginal[y + 1] = marginal[y] + rowSum;
        }

        // Normalize to [0, 1]
        const total = marginal[h];
        if (total > 0) {
            for (let i = 0; i <= h; i++) {
                marginal[i] /= total;
            }
        } else {
            // Degenerate case: uniform distribution
            for (let i = 0; i <= h; i++) {
                marginal[i] = i / h;
            }
        }

        return marginal;
    }

    private buildConditionalCDFs(luminance: Float32Array): Float32Array {
        const { samplingWidth: w, samplingHeight: h } = this;
        const conditional = new Float32Array(h * (w + 1));

        for (let y = 0; y < h; y++) {
            const rowOffset = y * (w + 1);

            // Build CDF for this row
            conditional[rowOffset] = 0;
            for (let x = 0; x < w; x++) {
                conditional[rowOffset + x + 1] =
                    conditional[rowOffset + x] + luminance[y * w + x];
            }

            // Normalize this row
            const rowTotal = conditional[rowOffset + w];
            if (rowTotal > 0) {
                for (let x = 0; x <= w; x++) {
                    conditional[rowOffset + x] /= rowTotal;
                }
            } else {
                // Black row: uniform distribution
                for (let x = 0; x <= w; x++) {
                    conditional[rowOffset + x] = x / w;
                }
            }
        }

        return conditional;
    }

    private computeAverageLuminance(luminance: Float32Array): number {
        const { samplingWidth: w, samplingHeight: h } = this;
        let sum = 0;

        for (let i = 0; i < w * h; i++) {
            sum += luminance[i];
        }

        // The sum already includes sin(theta) weighting
        // Divide by the integral of sin(theta) over the sphere (4π)
        return sum / (w * h) * 4 * Math.PI;
    }
}
