// Minimal stand-in for pbrt-v4's pbrt.h, vecmath.h and math.h: only what util/noise.cpp
// uses, with pbrt's single-precision Float and pbrt's definitions of Lerp, SmoothStep,
// Clamp, Log2 and Pow (pbrt-v4 src/pbrt/util/math.h).
#pragma once
#include <cmath>
#define PBRT_CPU_GPU
#define PBRT_CONST const
namespace pbrt {
using Float = float;
struct Vector3f { Float x, y, z; Vector3f(Float x = 0, Float y = 0, Float z = 0) : x(x), y(y), z(z) {} };
struct Point3f {
    Float x, y, z;
    Point3f(Float x = 0, Float y = 0, Float z = 0) : x(x), y(y), z(z) {}
    Point3f operator+(Vector3f v) const { return {x + v.x, y + v.y, z + v.z}; }
    Point3f operator-(Point3f p) const { return {x - p.x, y - p.y, z - p.z}; }
    Point3f operator/(Float s) const { return {x / s, y / s, z / s}; }
    operator Vector3f() const { return {x, y, z}; }  // DNoise returns a point difference
};
inline Point3f operator*(Float s, Point3f p) { return {s * p.x, s * p.y, s * p.z}; }
inline Float LengthSquared(Vector3f v) { return v.x * v.x + v.y * v.y + v.z * v.z; }
inline Float Lerp(Float x, Float a, Float b) { return (1 - x) * a + x * b; }
template <typename T, typename U, typename V> inline T Clamp(T val, U low, V high) {
    if (val < low) return T(low);
    if (val > high) return T(high);
    return val;
}
inline Float SmoothStep(Float x, Float a, Float b) {
    if (a == b) return (x < a) ? 0 : 1;
    Float t = Clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
}
inline Float Log2(Float x) {
    const Float invLog2 = 1.442695040888963387004650940071;
    return std::log(x) * invLog2;
}
template <int n> inline constexpr Float Pow(Float v) {
    if constexpr (n < 0) return 1 / Pow<-n>(v);
    Float n2 = Pow<n / 2>(v);
    return n2 * n2 * Pow<n & 1>(v);
}
template <> inline constexpr Float Pow<1>(Float v) { return v; }
template <> inline constexpr Float Pow<0>(Float v) { return 1; }
namespace pstd {
inline Float fmod(Float a, Float b) { return std::fmod(a, b); }
inline Float floor(Float a) { return std::floor(a); }
}  // namespace pstd
}  // namespace pbrt
