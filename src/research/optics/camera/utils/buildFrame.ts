export function buildFrame(position: number[], target: number[]): Float32Array {
    // Calculate forward vector (from camera toward target)
    const forward = normalize(subtract(target, position));

    // World up vector (assuming Y-up coordinate system)
    const worldUp = [0, 1, 0];

    // Calculate right vector (perpendicular to forward and up)
    const right = normalize(cross(forward, worldUp));

    // Calculate corrected up vector (perpendicular to right and forward)
    const up = cross(right, forward);

    // Return as 3x3 matrix in column-major order
    // [right.x, right.y, right.z, up.x, up.y, up.z, forward.x, forward.y, forward.z]
    return new Float32Array([
        right[0], right[1], right[2],
        up[0], up[1], up[2],
       - forward[0], -forward[1], -forward[2]
    ]);
}

// Helper functions for vector math
function subtract(a: number[], b: number[]): number[] {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: number[], b: number[]): number[] {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

function normalize(v: number[]): number[] {
    const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (length === 0) return [0, 0, 1]; // Fallback to forward
    return [v[0] / length, v[1] / length, v[2] / length];
}
