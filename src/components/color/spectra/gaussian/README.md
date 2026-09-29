# gaussian — a reflectance band

`{ gaussian: { center, width, peak, floor? } }`, wavelengths in nm. The fraction of light
reflected at wavelength λ is

`floor + (peak − floor) · exp(−½ ((λ − center) / width)²)`,

with `width` the standard deviation (the full width at half maximum is 2.355 · width) and
`floor` defaulting to 0. `floor` and `peak` lie in [0, 1], so the value is a physical fraction at
every wavelength; `floor` above `peak` is a notch (magenta, for example). It goes in reflectance
slots (surface colors, glass tint). Its numbers are constants.

**Spectral programs** evaluate the formula exactly at the ray's wavelengths.

**RGB programs** use its RGB stand-in: daylight (D65) reflected by the band, in linear sRGB,
divided channel by channel by the same projection of a perfect white reflector:

`s_c = ∫ g · D65 · (M x̄)_c dλ / ∫ D65 · (M x̄)_c dλ`,

where `M x̄` are the CIE 1931 color-matching functions taken to linear sRGB, and D65 is the same
float32 table the GPU uses (spectral/d65.ts). A perfect white gives (1, 1, 1). A saturated band
can have a stand-in outside [0, 1] (a narrow green needs a negative red); RGB programs then clip
it to [0, 1], with a compile warning naming the material, and spectral programs are unaffected.

A plain RGB color equal to the stand-in matches the band under daylight and differs from it under
other light (metamerism): identical in RGB renders, different in spectral renders under, say, a
2700 K blackbody.
