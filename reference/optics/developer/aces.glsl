// ACES Tonemapping Developer
// HDR to LDR with ACES filmic curve, highlight desaturation, and sRGB output
// No uniforms -- uses baked defaults

const float EXPOSURE_EV = 0.0;
const float DESAT       = 0.15;
const vec3  WHITE_BAL   = vec3(1.0);

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

const mat3 ACESInputMat = mat3(
   0.59719, 0.35458, 0.04823,
   0.07600, 0.90834, 0.01566,
   0.02840, 0.13383, 0.83777
);
const mat3 ACESOutputMat = mat3(
   1.60475,-0.53108,-0.07367,
  -0.10208, 1.10813,-0.00605,
  -0.00327,-0.07276, 1.07602
);

vec3 safe_color(vec3 c){
  c = max(c, vec3(0.0));
  bvec3 ok = lessThanEqual(abs(c), vec3(1e19));
  if(!(ok.x && ok.y && ok.z)) return vec3(0.0);
  return c;
}

vec3 linear_to_srgb(vec3 c){
  vec3 lo = 12.92 * c;
  vec3 hi = 1.055 * pow(max(c, 0.0), vec3(1.0/2.4)) - 0.055;
  bvec3 cutoff = lessThanEqual(c, vec3(0.0031308));
  return mix(hi, lo, vec3(cutoff));
}

vec3 highlight_desaturate(vec3 c, float amount){
  float peak = max(max(c.r,c.g), c.b);
  float t = clamp((peak - 0.80)/0.20, 0.0, 1.0);
  float l = dot(c, LUMA);
  return mix(c, vec3(l), amount * t);
}

vec3 tonemap_aces(vec3 x){
  vec3 c = ACESInputMat * x;
  const float a=2.51, b=0.03, c1=2.43, d=0.59, e=0.14;
  c = (c*(a*c + b)) / (c*(c1*c + d) + e);
  c = ACESOutputMat * c;
  return clamp(c, 0.0, 1.0);
}

RGB developer_develop(Radiance radiance){
  vec3 r = safe_color(radiance);
  r *= exp2(EXPOSURE_EV);
  r *= WHITE_BAL;

  vec3 tm = tonemap_aces(r);
  tm = highlight_desaturate(tm, DESAT);

  vec3 outRGB = clamp(linear_to_srgb(tm), 0.0, 1.0);
  return RGB(outRGB);
}
