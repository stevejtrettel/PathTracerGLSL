# Bindings: how a spectrum's numbers reach the GPU

**Status: parked (owner, September 28, 2026).** Temperature and brightness stay decoupled:
`kelvin` sets a blackbody's color and `scale` its brightness, so there is no `thermal` kind
(§2). Nothing in step 4 is needed now; it waits for a scene that needs per-instance
temperatures, and if one does, §3 option A (exact on the CPU) is the route that keeps them
decoupled. Step 4 of the [one-spectrum-type spec](claude-spectrum-spec.md); nothing here is
built. This draft was revised after an independent review (Appendix A). Facts are marked
**Checked** (read or run by me), **Reviewer** (measured by the independent reviewer) or
**Expected** (not measured).

---

# Part 1: the idea

Every number inside a spectrum (the three channels of a color, a blackbody's temperature and
brightness, a Cauchy coefficient) reaches the GPU in one of four ways, its **binding**:

| Binding | Written as | In the shader |
|---|---|---|
| constant | `0.5`, `[1, 0.8, 0.6]`, `3000` | a number written into the shader code |
| slider | `{ param: 'lamp.kelvin', default: 3000 }` | a *uniform*: a value the UI can change without recompiling |
| formula | `{ kind: 'glsl', source: '…' }` | GLSL evaluated at each point being shaded (position, uv) |
| per instance | `attributes: { … }` on an instanced object | a value read from the batch's data texture, indexed by which instance was hit |

The first three have one owner today (`emitValue`, compiler/generate/values.ts). Per-instance
values do not: they are wired at several places, and they can only replace a whole material row
with one RGB triple or one number per instance (**Checked**). A star cloud can have a different
*color* per star today, by writing each star's blackbody RGB as a per-instance color. That is
exact in RGB renders; in spectral renders it is a metamer (a different spectrum with the same
color). Below about 1900 K the blackbody's RGB has a negative blue channel (**Reviewer**), and
per-instance colors must be nonnegative in both renders, so there it is rejected outright. What
per-instance temperature adds is spectral fidelity and the full temperature range.

Step 4 has two parts:

- **4a, a refactor:** one owner for all four bindings. No output changes.
- **4b, a feature:** per-instance temperatures, so a star field can give each star its own
  temperature and render with true Planck spectra. It needs your decisions (§2, §3).

## 1. What 4b looks like to an author

The material says what every star is; the instanced object replaces its emission row per
instance, as per-instance colors already do:

```ts
materials: { star: { model: 'lambert', albedo: 0, emission: 0 } },
objects: [{ kind: 'instanced', prototype: { type: 'sphere', …, material: 'star' }, placements,
            attributes: { emission: { thermal: { kelvin: kelvins, scale: 1 } } } }],
```

The attribute key is still the material row (`emission`); its value is a spectrum whose numbers
may be arrays, one entry per instance. No new key syntax, and no new rules about which key wins.
For `.inst` clouds a small `instanceCloud` option is needed to route a named scalar column (such
as `kelvin`) into this attribute; today scalar columns reach only scene-side hooks, never the
GPU, by design (docs/fable-instance-clouds.md, pin 3; **Reviewer**). Per-instance emission stays
limited to sphere batches, as today.

## 2. First decision: what a varying temperature means for brightness

Today's `blackbody` holds brightness fixed: at any temperature, `scale = 1` means the same
reference brightness (CIE Y). You accepted this for lamp colors, where temperature is a color
control. A real hot body is different: its brightness rises steeply with temperature, about
439× from 3000 K to 10000 K, and by 6.8·10¹⁰ across 1000–40000 K (**Reviewer**). For stars or an
accretion disk that brightness is part of the physics.

| | Color temperature (today's `blackbody`) | Thermal (proposed `thermal`) |
|---|---|---|
| Emission | `scale · Planck(T) / Y(T)` | `scale · Planck(T) / Y(T_ref)` for one fixed reference `T_ref` |
| Brightness when T changes | constant | rises as a real blackbody's does |
| Per-temperature work | `Y(T)`: an integral against the CIE curve, ~1000 evaluations per temperature (**Checked**) | none: one constant |
| Per instance, per shading point | needs `Y(T)` per instance or per point (§3) | exact, closed form, on the GPU |
| Natural use | lamps, artist color | stars, accretion disks, anything physically hot |

**Recommendation:** add `thermal` as its own spectrum kind (one folder, one registry line) and
keep `blackbody` for lamp colors. Then per-instance and, later, formula temperatures are exact
and cheap, and the §3 question only arises if you also want per-instance *color temperature*.
`T_ref` would be chosen so `thermal` and `blackbody` agree at that temperature (for example
6500 K). What would change my mind: if you want star fields where every star has equal
brightness and only hue varies.

## 3. Second decision, only for per-instance color temperature

If per-instance or formula temperatures should also hold brightness fixed, each needs `Y(T)`:

| | A. Exact on the CPU, per instance | C. A fitted formula in 1/T |
|---|---|---|
| How | compute `Y(T)` for each instance when the batch is packed | a fixed polynomial in 1/T (Chebyshev, degree ~24), evaluated the same way in GLSL and on the CPU |
| Accuracy | exact | ~1·10⁻⁷ relative in 32-bit arithmetic (**Reviewer**) |
| Cost | ~29 µs per temperature once the fixed CIE weights are hoisted out of the loop, so ~30 s for 10⁶ distinct stars (**Reviewer**); packing already runs off the main thread | a few dozen multiply-adds per evaluation |
| Formulas | no | yes |
| Rules | fits the codebase's rule that derived values are computed on the CPU, never per pixel (values.ts header) | breaks that rule; it would need amending |

A lookup texture read on the GPU (my first draft's option) is dropped: it needs a new data
texture, the data-texture sampler has no high-precision declaration (a known open defect),
linear interpolation needs two fetches, and the fitted formula does everything it does without
those costs (**Reviewer**). **Recommendation:** skip §3 unless you want it; if you do, A.

---

# Part 2: the plan

## 4. Step 4a: one owner for the four bindings (refactor)

**Problem (Checked, Reviewer):** a per-instance value is read at these places: the material
fill (generate/features/materials.ts, via `emitAttributeValue`, with `element` in scope), the
batch light arm (lighting.ts `batchSphereExpr`, its own inline fetch with the instance-index
expression), the CPU read of per-instance emission for light-tree power (app/sceneData.ts,
`(k * rows + slot) * 4`, fed by compiler/sceneData.ts), and the layout sites that size and place
the rows (dataTenants.ts, Planner.ts placeScene). `emitValue` throws on a per-instance value, and
two sites lift its color by hand instead of through the spectrum kind.

**Rule after:** a value's binding is emitted in one place. A per-instance value is emitted by the
same function as the other three, given the GLSL expression of the instance index at that site;
the texel address has one definition, shared by the GLSL and the CPU sides.

**What changes:**
1. components/intersection/instancing/instancing.ts: one GLSL fetch builder
   `attributeFetch(attribute, instanceExpr)` and one CPU offset `attributeOffset(instance, slot,
   rows)`, next to the slot-order function and the packer, which uses the offset.
2. compiler/generate/values.ts: `emitValue` takes an options object (the expression formatter
   and the instance expression) and emits a per-instance value through `attributeFetch`;
   `emitAttributeValue` goes. `ParamValue` gains `AttributeValue`.
3. generate/color.ts: `spectrumContext` captures the instance expression in its `bind`, so the
   spectrum kinds do not see it. materials.ts and lighting.ts emit per-instance rows through
   `emitSpectrum`/`emitValue`; the light arm passes its index already parenthesized, as today.
4. app/sceneData.ts reads per-instance emission through `attributeOffset`.

**Verification:** the digest identical for every scene (per-instance paths: `spectral-packed`, the
`spheres` demo, the instance witnesses). The digest does not cover the App's packing, so the
byte fingerprints in tests/app/sceneData.test.ts (including the batch with an emission
attribute) must pass unchanged. A scan test with an explicit list of the files allowed to build a
per-instance address or test `isAttributeValue`. Typecheck, the full test run, an independent
review.

## 5. Step 4b: per-instance temperature (after your decisions)

Outline, written in full once §2 (and §3) are decided. Assuming `thermal`:
1. The `thermal` kind: spelling `{ thermal: { kelvin, scale } }`, domain 1000–40000 K,
   `Planck(T)/Y(T_ref)` in GLSL (a variant of `blackbody_emission` without the per-temperature
   factor), RGB projection on the CPU, light-table header like blackbody's.
2. Per-instance numbers inside a kind: the attribute value is a kind whose numbers may be arrays;
   the Planner binds each array to an attribute slot; the kind's `emit` receives a per-instance
   binding for that number, through the 4a binding function.
3. RGB renders need each instance's RGB projection, which is an integral: computed on the CPU at
   packing (hoisted quadrature, or a CPU table used only there) and stored per instance.
4. Light-tree power per instance from the same CPU projection; it must be positive wherever the
   emission is, and otherwise it only steers sampling.
5. The `instanceCloud` option routing a scalar column into the attribute.
6. Verification: a per-instance star field against the same stars as separate constant emitters
   (equal images) in RGB and spectral renders; NEE/MIS equality; tree versus power selection;
   `thermal` against `blackbody` at `T_ref`.

## 6. Decisions for you

1. **Step 4a** as written in §4? (Recommended; a pure refactor, and it can start now.)
2. **§2:** a separate `thermal` kind for physically hot things, keeping `blackbody` for lamp
   colors? (Recommended.) Or per-instance temperature with constant brightness?
3. **§3:** only if you want per-instance color temperature: A (exact on the CPU) or C (a fitted
   formula)?
4. **Spelling:** the attribute replaces the emission row with a spectrum whose numbers are arrays
   (§1)? (Recommended.)

---

## Appendix A: what the independent review of the first draft found

| Finding | Change |
|---|---|
| The design assumed every temperature keeps constant brightness without asking; a thermal convention needs no per-temperature normalization at all | §2 is now the first decision |
| The GPU table breaks the "derived values on the CPU" rule and the instance-cloud rule that scalar columns never reach the GPU; its route to the GPU was unspecified; the data-texture sampler has no precision declaration; linear interpolation needs two fetches, not one | table dropped; the rules are named in §1 and §3 |
| Cost measured: 102 µs per `Y(T)`, 29 µs with the fixed weights hoisted; a fitted Chebyshev form in 1/T reaches ~1e-7 in 32-bit | §3 uses the measurements; option C added |
| "Changes no witness value" could not fail (witness tolerances are ~1000× the target), and switching constants would change every blackbody literal and the packed light-table header | the constants switch is gone with the table |
| The `'emission.kelvin'` spelling conflicts with current validation, slot ordering, light eligibility and the Planner in five places | spelling now keeps the key as the row (§1) |
| Step 4a missed sites (compiler/sceneData.ts, dataTenants.ts, Planner.ts), traps (`emitValue`'s positional formatter, `ParamValue` without `AttributeValue`), and that the digest does not cover App-side packing | §4 lists them; the App fingerprint tests are named |
| Today's workaround (per-instance blackbody RGB) and the sphere-batch limit were not stated | §1 states both |

The review confirmed: the four bindings and where they live; ~1000 Planck evaluations per `Y(T)`;
the CPU computing it per constant and per slider change; `.inst` scalar columns exist; that the
light and its hit-side emission agree for any of these options; and that 4a can reproduce today's
generated text exactly.
