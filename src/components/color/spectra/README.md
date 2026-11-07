# color/spectra/ — spectrum kinds

A spectrum is a function of wavelength. Its **kind** is the way it was produced
([spec](../../../../docs/claude-spectrum-spec.md), Part 1):

| Kind | Authored as | Roles |
|---|---|---|
| `rgb` | a number (gray, or one index at every wavelength), an RGB triple, a `{param}`, a GLSL expression (an image texture arrives as one: compiler/analyze/imageTextures.ts lowers it before Analyze) or a per-instance attribute | reflectance, coefficient, emission, index |
| [`blackbody`](blackbody/README.md) | `{ blackbody: { kelvin, scale } }` | emission |
| [`cauchy`](cauchy/README.md) | `{ cauchy: [A, B, C?] }` | index |
| [`sellmeier`](sellmeier/README.md) | `{ sellmeier: { B, C } }` | index |
| [`gaussian`](gaussian/README.md) | `{ gaussian: { center, width, peak, floor? } }` (nm) | reflectance |

The **role** belongs to the slot a value sits in, never to the value: reflectance, coefficient
and emission for radiometric rows, index for refractive-index rows. The role decides how a
spectrum is read: the direction of the RGB conversion (the color model lifts an RGB triple by
role), the domain every value must lie in (reflectance, coefficient and emission nonnegative,
index positive; the spectral model also limits reflectance to 1), and the units.

## The contract

`spectrumKind.ts` defines `SpectrumKind`. A kind answers every question the compiler asks
about its values:

- `is` recognizes its authored data. A named kind is written `{ <id>: … }`: one key, the kind's
  id, holding its numbers. `roles` lists the slots it may go in;
- `liveParams` names its live sliders;
- `fields` declares its numbers where they sit in an object: each one's domain, and whether it
  may be a slider, may be omitted or is a triple. The compiler checks them like every other
  authored number: their keys, their sliders' structure, their domains. `validate` checks the
  rules that relate several numbers (Sellmeier's positive n²) or that `fields` cannot state
  (Sellmeier's poles outside the visible range, Cauchy's array), and runs only when the fields
  are valid;
- `toRGB` gives its RGB stand-in: the RGB value for a radiometric role, the index at the helium
  d line (587.5618 nm) for the index role;
- `constantNonzero` and `mayBeNonzero` answer the light census and the emitter checks;
- `dispersive` says whether, as an index, it varies with wavelength (which forces the one-time
  hero collapse);
- `emit` writes its GLSL at the ray's wavelengths, `glsl` holds the helpers it calls, and
  `mint` adds its sliders and the uniforms its `emit` reads (blackbody's temperature). A kind
  never asks whether the program is RGB or spectral. An RGB program never calls its `emit`: it
  shows the kind's stand-in (`toRGB`, a reflectance clipped to [0, 1]) through the `rgb` kind,
  keeps the kind's sliders, and carries a live stand-in in one uniform the CPU recomputes;
- `packed` lets a light-table row keep it whole in the row header (blackbody).

Kinds import only types from the compiler. The operations the compiler owns (binding a number as
a literal, uniform or expression; the color model's lift; minting a slider) reach them through
`EmitContext` and `MintContext`.

`index.ts` is the registry: `SPECTRUM_KINDS` in lookup order (the index formulas, then
blackbody and gaussian, then `rgb`, which claims everything else), `kindOf`, `namedKindOf`,
`kindById` and `rgbKind`.
A program lists the kinds it evaluates at wavelengths in `ProgramDescription.spectrumKinds`
(registry order); their `glsl` helpers are linked in that order.

Outside this folder, code does not test for a particular kind at run time (no kind predicate,
kind object, id comparison or authored-key check); tests/components/spectrumKinds.test.ts scans
for these. The authored value types (`BlackbodyValue`, `GaussianValue`, `CauchyIndex`,
`SellmeierIndex` in compiler/types.ts) still name each kind's spelling, so a new kind also adds its type to the
`NamedSpectrumValue` union (or `SpectralIndex` for an index formula).

## Adding a kind

One folder with `<id>.ts` (the `SpectrumKind`), any `<id>.glsl` helpers and a README stating its
spelling, units, domain and RGB meaning; one line in `index.ts`; and an example value in
tests/components/spectrumKinds.test.ts, which checks its spelling against its `fields`. A kind
that is the first to need a new capability in some reader (for example a maximum over
wavelength for a medium's tracking bound) adds that method to the contract and to the reader,
not a test for itself.
