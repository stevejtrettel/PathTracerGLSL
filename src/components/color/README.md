# color/ — transport representation and film projection

**Taxonomy:** measurement. **Kind:** pick-one.

`measurement.color` selects the colour model. RGB is currently the only implemented model;
spectral selection remains validation-rejected.

An occupant supplies `types.glsl` and `<id>.glsl`:

- `Spectrum`, `Radiance` and `SPECTRUM_N` define the transport values.
- `Wavelengths` describes wavelength coordinates; `WavelengthSample` keeps the camera
  coordinates and their sampling densities together. RGB uses initialized placeholders.
- `wavelengths_sample()` creates that camera sample. RGB consumes no random numbers.
- `color_to_pixel(film, ray_dir, L, camera_sample)` applies the sensor response and projects
  transport radiance to signed linear-sRGB. RGB multiplication is component-wise.

Types are included before the core structs. Functions follow the sampler and shared math.
`spectrum.glsl` supplies channel-count-independent reductions and uniform channel selection.
Its sum and nested maximum preserve the RGB evaluation order.

The sensor owns the measurement response; the colour model owns the wavelength integral.
Each accumulator samples the camera, traces radiance, and projects it before updating its
film statistics. Display transforms remain downstream.

`Ray.wl` carries current wavelengths; `Hit.wl` records arrival wavelengths. Material and
medium resolution records carry their evaluation wavelengths. The original camera sample
stays with the accumulator for sensor integration.

`color_lift_reflectance`, `color_lift_coefficient` and `color_lift_emission` evaluate authored
RGB at an explicit carrier. Radiometric descriptor rows declare their role. All three are
identities in RGB. Uniforms and packed rows stay authored RGB; filtering, expression evaluation
and medium clamps happen before conversion. Blackbody still uses the existing RGB projection;
preserving its authored form through scene planning is the next stage.

To add an occupant, define its descriptor and GLSL inside its own folder and register it in
`index.ts`. Enable authoring/validation only when its supported paths are implemented. The
RGB placeholder sampler draws nothing; future wavelength sampling policies are estimator
choices, separate from the measurement's colour representation.

`npm run witness:color` executes the spectrum operations at N=2,3,4 and the RGB film projection
with identity and nonidentity sensors. It also checks that deliberately broken versions fail.

`npm run witness:wavelengths` runs generated shaders with a visible four-value carrier,
including cameras, arrivals, property resolution, lighting, phase continuation, shadow
crossings and GRIN. Test-only nonidentity lifts expose conversion bypasses and clamp order.
