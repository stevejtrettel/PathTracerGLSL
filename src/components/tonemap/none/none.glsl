// tonemap 'none' — identity curve (raw linear passthrough).
// The display main() applies NO sRGB encode for this occupant (encodesToDisplay=false)
// and exposure is forced to 1.0, so what §11 on-screen radiance probes read is exactly
// what the accumulator holds (clamped to [0,1] only by the 8-bit target). NaN/Inf and
// negatives are sanitized by the shared safe_color() in the display glue.

vec3 none_curve(vec3 x) {
    return x;
}
