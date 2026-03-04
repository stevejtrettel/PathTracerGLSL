// HDRI Environment with Importance Sampling
// CDF-based importance sampling for efficient environment light estimation
// Uniforms: u_env_map, u_env_intensity, u_env_rotation,
//           u_env_cdf_conditional, u_env_cdf_marginal, u_env_size, u_env_totalWeight
// Depends on: random2(), LightSample struct

uniform sampler2D u_env_map;
uniform float     u_env_intensity;
uniform float     u_env_rotation;
uniform sampler2D u_env_cdf_conditional;
uniform sampler2D u_env_cdf_marginal;
uniform vec2      u_env_size;
uniform float     u_env_totalWeight;

#define PI      3.14159265359
#define TWO_PI  6.28318530718

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec2 direction_to_equirect(vec3 dir) {
  vec3 n = normalize(dir);
  float phi   = atan(n.z, n.x) + u_env_rotation;
  float theta = acos(clamp(n.y, -1.0, 1.0));
  float u = phi * (1.0 / TWO_PI) + 0.5;
  float v = theta * (1.0 / PI);
  return vec2(u, v);
}

vec3 equirect_to_direction(vec2 uv) {
  float phi   = (uv.x - 0.5) * TWO_PI + u_env_rotation;
  float theta = uv.y * PI;
  float s = sin(theta), c = cos(theta);
  return normalize(vec3(cos(phi) * s, c, sin(phi) * s));
}

vec3 environment_radiance(vec3 direction) {
  vec2 uv = direction_to_equirect(direction);
  vec3 rgb = texture(u_env_map, uv).rgb;
  return rgb * u_env_intensity;
}

int envW() { return int(u_env_size.x + 0.5); }
int envH() { return int(u_env_size.y + 0.5); }

float cdf_marg(int j)       { return texelFetch(u_env_cdf_marginal,    ivec2(0, j), 0).r; }
float cdf_cond(int j, int i){ return texelFetch(u_env_cdf_conditional, ivec2(i, j), 0).r; }
vec3  texRGB(int i, int j)  { return texelFetch(u_env_map,             ivec2(i, j), 0).rgb; }

int find_row(float u) {
  int H = envH();
  int lo = 0, hi = H - 1;
  while (lo < hi) {
    int mid = (lo + hi) >> 1;
    float c = cdf_marg(mid);
    if (u > c) lo = mid + 1; else hi = mid;
  }
  return lo;
}

int find_col(int j, float u) {
  int W = envW();
  int lo = 0, hi = W - 1;
  while (lo < hi) {
    int mid = (lo + hi) >> 1;
    float c = cdf_cond(j, mid);
    if (u > c) lo = mid + 1; else hi = mid;
  }
  return lo;
}

float env_pdf_texel(int i, int j) {
  int W = envW(), H = envH();
  float theta = PI * (float(j) + 0.5) / float(H);
  float sinT  = max(1e-6, sin(theta));
  vec3  rgb   = texRGB(i, j) * u_env_intensity;
  float Y     = max(0.0, dot(rgb, LUMA));
  float dOmega = (2.0*PI/float(W)) * (PI/float(H)) * sinT;
  float w_ij   = Y * sinT;
  return (u_env_totalWeight > 0.0) ? (w_ij / u_env_totalWeight) / dOmega : 0.0;
}

float environment_pdf(vec3 direction) {
  vec2 uv = direction_to_equirect(direction);
  int W = envW(), H = envH();
  int i = int(clamp(floor(uv.x * float(W)), 0.0, float(W - 1)));
  int j = int(clamp(floor(uv.y * float(H)), 0.0, float(H - 1)));
  return env_pdf_texel(i, j);
}

LightSample environment_sample(Point p) {
  LightSample ls;
  vec2 xi = random2();
  int j = find_row(xi.x);
  int i = find_col(j, xi.y);
  int W = envW(), H = envH();
  float u = (float(i) + fract(xi.x * float(W))) / float(W);
  float v = (float(j) + fract(xi.y * float(H))) / float(H);
  vec3 dir = equirect_to_direction(vec2(u, v));
  ls.wi       = dir;
  ls.position = p + dir * 1e6;
  ls.distance = 1e6;
  ls.radiance = texture(u_env_map, vec2(u, v)).rgb * u_env_intensity;
  ls.pdf      = env_pdf_texel(i, j);
  return ls;
}
