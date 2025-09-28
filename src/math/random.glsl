// math/random.glsl - Start simple


const float UINT_MAX = 4294967295.0; // 2^32 - 1


uint hash3(uint x, uint y, uint z) {
    // Mix pixel position and frame number
    uint h = x;
    h ^= y * 2654435761u;
    h ^= z * 2654435769u;
    h *= 2654435761u;
    return h;
}

// PCG-based RNG: pseudorandom integer between 0 and 2^32
uint pcg(inout uint state) {
    uint oldstate = state;
    state = oldstate * 747796405u + 2891336453u;
    uint word = ((oldstate >> ((oldstate >> 28u) + 4u)) ^ oldstate) * 277803737u;
    return (word >> 22u) ^ word;
}

float random(inout uint state) {
    return float(pcg(state)) / UINT_MAX;
}

vec2 random2(inout uint state) {
    return vec2(random(state), random(state));
}
