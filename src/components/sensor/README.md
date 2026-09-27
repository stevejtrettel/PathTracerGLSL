# sensor/ — measurement response

**Taxonomy:** measurement. **Kind:** pick-one.

`measurement.sensor` selects the response; when omitted, the colour model supplies its
default. Sensor descriptors declare compatible colour models, checked by the compiler.

- `ideal` is the RGB default. `Spectrum sensor_response(vec2 film, Direction ray_dir)`
  returns `SPECTRUM_ONE`; the RGB colour projection applies it component-wise.
- `cie1931` is the spectral default. `vec3 sensor_response(float lambda, vec2 film,
  Direction ray_dir)` returns the signed linear-sRGB response per wavelength in nm:
  `M * xyz(lambda) / integral(ybar)`. Curves and normalization match the versioned
  [spectral model](../color/spectral/README.md).

The sensor owns the measurement response, including the XYZ-to-RGB matrix and its
normalization. The colour model owns transport representation and wavelength integration;
it calls the response at each original camera wavelength, dividing by that lane's PDF.
Accumulators receive signed linear RGB before updating the mean or variance. Display
transforms remain downstream.

`film` is normalized camera film position; `ray_dir` is the primary direction. Both
current occupants are spatially uniform. Exposure, vignetting and camera-specific
spectral curves remain deferred. The compiler includes the selected sensor after any
colour-model curve helpers and before the colour projection that calls it.
