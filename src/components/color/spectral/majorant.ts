/** Numerical domain of the authored density ceiling; see README.md, Tracking bound. */
export const spectralCeilingRange = [2 ** -60, 2 ** 18] as const;

/** RGB-field ceiling and spectral tracking rate, both exactly representable float32s. */
export function spectralMediumBound(authoredCeiling: number): { ceiling: number; majorant: number } {
    const ceiling = Math.fround(authoredCeiling);
    // Four coefficient amplitudes, including field/rate literal conversion and the
    // clamp/lift/addition error chain.
    // delta covers a highp add/multiply/divide error, including non-nearest rounding.
    const delta = 2 ** -20;
    const up = 1 + delta, down = 1 - delta;
    const bound = 4 * ceiling * up * up * up * up * up / (down * down);
    const rounded = new Float32Array([bound]);
    // Step above round-to-nearest to cover both float32 conversion and the few
    // binary64 operations above. The bound is positive and normal in this domain.
    new Uint32Array(rounded.buffer)[0]++;
    return { ceiling, majorant: rounded[0] };
}
