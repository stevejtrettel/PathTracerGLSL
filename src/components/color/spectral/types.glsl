#define Spectrum vec4
#define Radiance Spectrum
#define SPECTRUM_N 4
struct Wavelengths { vec4 lambda; };
struct WavelengthSample { Wavelengths wl; vec4 pdf; };
