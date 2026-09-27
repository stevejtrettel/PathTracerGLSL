#define Spectrum vec2
#define Radiance Spectrum
#define SPECTRUM_N 2
struct Wavelengths { float unused; };
struct WavelengthSample { Wavelengths wl; float pdf; };
