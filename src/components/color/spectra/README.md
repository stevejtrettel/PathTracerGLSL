# color/spectra/ — spectrum kinds

A spectrum is a function of wavelength. Its **kind** is the way it was produced
([spec](../../../../docs/claude-spectrum-spec.md), Part 1):

| Kind | Authored as | Roles |
|---|---|---|
| `rgb` | a number (gray, or one index at every wavelength), an RGB triple, a `{param}`, a GLSL expression or a per-instance attribute | reflectance, coefficient, emission, index |
| [`blackbody`](blackbody/README.md) | `{ blackbody: { kelvin, scale } }` | emission |
| [`cauchy`](cauchy/README.md) | `{ cauchy: [A, B, C?] }` | index |
| [`sellmeier`](sellmeier/README.md) | `{ sellmeier: { B, C } }` | index |

The **role** belongs to the slot a value sits in, never to the value: reflectance, coefficient
and emission for radiometric rows, index for refractive-index rows. The role decides how a
spectrum is read: the direction of the RGB conversion (the color model lifts an RGB triple by
role), the domain every value must lie in (reflectance, coefficient and emission nonnegative,
index positive; the spectral model also limits reflectance to 1), and the units.

## The contract

`spectrumKind.ts` defines `SpectrumKind`. A kind answers every question the compiler asks
about its values:

- `is` recognizes its authored data; `roles` lists the slots it may go in;
- `liveParams` names its live sliders; `validate` checks its own numbers;
- `toRGB` gives its RGB stand-in: the RGB value for a radiometric role, the index at the helium
  d line (587.5618 nm) for the index role;
- `constantNonzero` and `mayBeNonzero` answer the light census and the emitter checks;
- `dispersive` says whether, as an index, it varies with wavelength (which forces the one-time
  hero collapse);
- `emit` writes its GLSL at the ray's wavelengths, `glsl` holds the helpers it calls, and
  `mint` adds the uniforms and sliders it derives (blackbody's temperature);
- `packed` lets a light-table row keep it whole in the row header (blackbody).

Kinds import only types from the compiler. The operations the compiler owns (binding a number as
a literal, uniform or expression; the color model's lift; minting a slider) reach them through
`EmitContext` and `MintContext`.

`index.ts` is the registry: `SPECTRUM_KINDS` in lookup order (the index formulas, then
blackbody, then `rgb`, which claims everything else), `kindOf`, `namedKindOf`,
`namedKindsClaiming` (more than one is a malformed value), `kindById` and `rgbKind`.
A program lists the kinds it evaluates at wavelengths in `ProgramDescription.spectrumKinds`
(registry order); their `glsl` helpers are linked in that order.

Outside this folder, code does not test for a particular kind at run time (no kind predicate,
kind object, id comparison or authored-key check); tests/components/spectrumKinds.test.ts scans
for these. The authored value types (`BlackbodyValue`, `CauchyIndex`, `SellmeierIndex` in
compiler/types.ts) still name each kind's spelling, so a new kind also extends those unions.

## Adding a kind

One folder with `<id>.ts` (the `SpectrumKind`), any `<id>.glsl` helpers and a README stating its
spelling, units, domain and RGB meaning; one line in `index.ts`. A kind that is the first to
need a new capability in some reader (for example a maximum over wavelength for a medium's
tracking bound) adds that method to the contract and to the reader, not a test for itself.
