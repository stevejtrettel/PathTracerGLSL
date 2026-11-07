// The standard normal CDF Φ(x) = ½ erfc(−x/√2). erfc is the Chebyshev fit of Press et al.,
// Numerical Recipes in C, 2nd ed., §6.2 (`erfcc`), whose fractional error is below 1.2·10⁻⁷
// for every x. Used by the Gaussian pixel-filter twin and the filter-edge witness.

function erfc(x: number): number {
    const z = Math.abs(x);
    const t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418
        + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587
        + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
}

export function normalCdf(x: number): number {
    return 0.5 * erfc(-x / Math.SQRT2);
}
