# rgb — plain values

The kind of every spectrum value that is not a named kind: a number, an RGB triple, a
`{ param, default, min?, max? }` slider, a GLSL expression, or a per-instance attribute. In a
radiometric slot a single number means gray; in an index slot it is one index at every
wavelength.

**RGB programs** use the value exactly as authored: the color model's lift is the identity.
**Spectral programs** lift the RGB triple at the ray's wavelengths by the slot's role
(`color_lift_reflectance`, `_coefficient`, `_emission`; see the
[spectral color model](../../spectral/README.md)). Arithmetic an author writes (an expression, a
sky's intensity factor) happens in RGB, before the lift.

**Domain:** the slot's role; nonnegative for reflectance, coefficient and emission, positive for
an index. The spectral model also limits reflectance to [0, 1], because its bounded lift cannot
represent more; RGB programs allow reflectance above 1.

`toRGB` is the value itself (a number broadcast to a triple), read at the given slider values.
Its GLSL is the bound value (a literal, a uniform or the expression) passed to the role's lift.
