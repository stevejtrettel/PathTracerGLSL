// Golden values of pbrt-v4's Perlin noise (src/pbrt/util/noise.cpp, compiled unmodified)
// for tests/glsl/perlin.test.ts. FBm and Turbulence get zero ray differentials: that is the
// zero-footprint limit, where pbrt sums every authored octave, the case our GLSL transcribes.
// Run: node tools/perlin-golden/run.mjs (writes tests/fixtures/perlin-pbrt-golden.json).
#include <pbrt/util/noise.h>
#include <cstdint>
#include <cstdio>
#include <vector>

using namespace pbrt;

static uint32_t state = 12345u;
static float uniform(float lo, float hi) {  // 24-bit LCG draws: every point is fp32-exact
    state = state * 1664525u + 1013904223u;
    return lo + (hi - lo) * float(state >> 8) / float(1u << 24);
}

int main() {
    std::vector<Point3f> points;
    for (int i = 0; i < 120; ++i) points.push_back({uniform(-4, 4), uniform(-4, 4), uniform(-4, 4)});
    for (int i = 0; i < 60; ++i) points.push_back({uniform(-600, 600), uniform(-600, 600), uniform(-600, 600)});
    for (int i = 0; i < 30; ++i)  // lattice points: noise is zero there
        points.push_back({std::floor(uniform(-300, 300)), std::floor(uniform(-300, 300)), std::floor(uniform(-300, 300))});
    for (int i = 0; i < 60; ++i) {  // one coordinate on a cell face
        Point3f p{uniform(-20, 20), uniform(-20, 20), uniform(-20, 20)};
        if (i % 3 == 0) p.x = std::floor(p.x); else if (i % 3 == 1) p.y = std::floor(p.y); else p.z = std::floor(p.z);
        points.push_back(p);
    }
    for (int i = 0; i < 30; ++i) points.push_back({uniform(-0.01f, 0.01f), uniform(255.9f, 256.1f), uniform(-256.1f, -255.9f)});
    Vector3f zero(0, 0, 0);
    std::printf("{\n  \"source\": \"pbrt-v4 src/pbrt/util/noise.cpp, compiled by tools/perlin-golden\",\n");
    std::printf("  \"columns\": [\"x\", \"y\", \"z\", \"noise\", \"fbm(0.5,8)\", \"turbulence(0.5,6)\", \"fbm(0.7,3)\", \"turbulence(0.8,1)\"],\n");
    std::printf("  \"rows\": [\n");
    for (size_t i = 0; i < points.size(); ++i) {
        Point3f p = points[i];
        std::printf("    [%.9g, %.9g, %.9g, %.9g, %.9g, %.9g, %.9g, %.9g]%s\n", p.x, p.y, p.z, Noise(p),
                    FBm(p, zero, zero, 0.5f, 8), Turbulence(p, zero, zero, 0.5f, 6),
                    FBm(p, zero, zero, 0.7f, 3), Turbulence(p, zero, zero, 0.8f, 1),
                    i + 1 < points.size() ? "," : "");
    }
    std::printf("  ]\n}\n");
}
