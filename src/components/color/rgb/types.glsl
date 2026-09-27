#define Spectrum vec3
#define Radiance Spectrum
#define SPECTRUM_N 3

// RGB has no wavelength coordinate or sampling density. Initialized placeholders
// let the film boundary use the same camera-sample contract as spectral transport.
struct Wavelengths { float unused; };
struct WavelengthSample { Wavelengths wl; float pdf; };
