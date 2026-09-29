# Plan: the bugs from the Sep 28 spectral review

The owner approved fixing the bugs in docs/claude-spectral-review-2026-09-28.md, Part 2 §A
("yes fix the bugs", Sep 28). This file records each fix: what changes, what doesn't, and the
test written first. Line numbers refer to commit 5dbf4e3. A3 is held back, because its fix adds an App-to-compiler interface; it is
listed at the end for the owner.

## A1. Surface Russian roulette divides 0 by 0

**Problem.** [read] The generated `roulette()` (pt.ts:205–210) computes
`p_survive = min(RR_MAX_SURVIVAL, spectrum_max(throughput))`, draws `random() > p_survive`,
then divides by `p_survive`. The walk can reach this point with exactly zero throughput:
- delta tracking's absorption arm returns `weight = 0` with `scattered = false`;
- the hero collapse zeroes three lanes, and lane 0 may already be 0.

`random()` returns exactly 0 with probability 2⁻²⁴ (pcg4d.glsl:35). When it does, the result is
0/0 = NaN, which spoils the pixel's running mean for good.

**Fix.** Add `if (p_survive <= 0.0) return false;` before the draw. This is the same line the
interior rule already has (pt.ts:263).

**Output.** [read] The RNG is seeded per (pixel, sample, reset) and each invocation traces one
path (average.glsl). A path that fails roulette ends either way, so skipping its last draw
changes no other path. Images are identical except where they were NaN.

**Test first.** A vitest on the generated shader: in `roulette()`, a return on
`p_survive <= 0.0` comes before the random draw. It fails today. It is a text check, the only
level vitest can reach, since a GPU test cannot force `random()` to return 0.

## A2. Blackbody validation crashes or misses malformed values

**Problem.** [run] Four malformed values, each misbehaving in both color models:
- `kelvin: {param: 5, …}` passes validation, then crashes the compile.
- `{blackbody: null}` makes `validate` throw.
- `{blackbody: undefined}` as the sky makes the Analyzer throw (`mayBeNonzero` reads
  `v.blackbody.scale`).
- A misspelled `scale` is ignored silently.

**Fix, inside blackbody.ts plus one shared helper.**
- **Census methods tolerate malformed values.** `liveParams`, `constantNonzero` and
  `mayBeNonzero` read the dials through one accessor that treats a non-object `blackbody` as
  empty. The census runs before validation, so it must never throw.
- **`validate` checks the object first.** A missing, non-object or array `blackbody` gets the
  report "blackbody must be an object { kelvin, scale? }", and any key other than `kelvin` and
  `scale` is reported.
- **The slider's structure is checked in one place.** "The path is a non-empty string" and
  "min ≤ max" move into `components/param.ts`, used by both `validatePropertyValue` and
  blackbody's `checkDial`. That file is where `isValueParam` already lives, and components may
  import it. `validatePropertyValue`'s messages do not change. One blackbody message does:
  "kelvin slider min above max" now gets the shared "parameter min must be <= max" instead of
  the range message. That is one diagnostics-snapshot entry, updated deliberately.
- **Not done here:** merging `checkDial`'s domain check into the shared checker. That needs a
  change to the kind contract (B5), which belongs in the design note.

**Test first.** The Validator, not a crash, reports all four values in both models, and the
compile throws a `CompilationError`. Today three of them throw a `TypeError` and one compiles.
Every other entry of the diagnostics snapshot must stay byte-identical.

## A4. The reflectance lift overflows for a tiny largest channel

**Problem.** [arithmetic] lookup.glsl:18 computes `other * (63.0 / z)`. For 0 < z below about
1.85·10⁻³⁷, `63/z` is +Inf in float32, so `0·Inf = NaN` and `ivec2(NaN)` is undefined.

**Fix.** `other / z * 63.0`. Since other ≤ z, the quotient is at most 1 (plus rounding), and
63/z is never formed. The CPU twin (lookup.ts:8) gets the same expression, so the two stay
textually alike.

The independent review noted that GLSL lets a compiler reorder this back into `other * (63/z)`.
That is theoretical: none of the GPUs we test does it. The owner asked for the plain form, and
the code keeps it.

**Output.** [expected, to be measured] Every spectral shader's text changes, and rounding
changes in the last bits of table coordinates. The digest will show the text change; the
witnesses check the numbers.

**Test first.** A probe in `witness:spectral` evaluates `spectral_coefficients` on the GPU at
(1e-37, 0.5e-37, 0) and (1e-37, 0, 0), scaled by a runtime 1.0 so the compiler cannot fold it.
It asserts finite coefficients equal to the CPU twin's. Run against the current lookup, it
must fail (NaN).

## A5. The kelvin slider's default range can exclude its default

**Problem.** [read] blackbody.ts:147 gives `range: [min ?? 1000, max ?? 12000]`, so a valid
default of 20000 K gets a slider that ends at 12000.

**Fix.** The upper end becomes `max ?? Math.max(12000, default)`.

**Test first.** Kelvin default 20000 gives a range whose top is at least 20000. Fails today.

## A6. Per-instance attribute values ignore the row's own constraint

**Problem.** [reviewer ran it; read] Validator.ts:1200 uses `roleDomain(role)`, while
`validatePropertyValue` uses `contract.constraint ?? roleDomain(role)`
(propertyValidation.ts:111). A per-instance checker `uv_scale` of −1 passes; the same value on
the material is rejected.

**Fix.** One function, `slotDomain(contract)` in propertyValidation.ts, used by both.
Radiometric messages stay identical.

**Test first.** A per-instance `uv_scale: [-1, 0]` is rejected. Passes today with no error.

## Verification after the fixes

- **Static checks:** `npx tsc --noEmit`, then `npx vitest run` (all).
- **Digest before and after.** Expected differences, and nothing else:
  - A1: the roulette text, in every scene with Russian roulette;
  - A4: the lookup text, in every spectral scene.
  - A2, A5 and A6 change no suite scene's output. A5 changes metadata only when a kelvin
    default exceeds 12000, and no suite scene is expected to have one.
- **Targeted GPU runs**, under `caffeinate -i`: `witness:spectral` (the new probe), then
  `spectral-colored-furnace spectral-plane spectral-materials`, whose reflectance lifts cover
  A4. No full sweep.
- **Review:** an independent fresh-agent review of the diff before it is reported.
- **Records:** one commit per item, and one CHANGELOG entry for the batch.

## Non-goals

- The design items B1–B7 are not touched.
- The kind contract (`SpectrumKind`) does not change.

## Held for the owner: A3

The sky-versus-lights split under the light tree ignores instanced lights (lighting.ts:508).
It costs variance only.

Only the App knows the instanced lights' powers, after it packs their placements
(app/sceneData.ts:112–137). The compiler's closure for `u_envSelectProb` cannot see them.

The fix that follows existing practice: the App sums the instanced lights' power and sets a
measured parameter, as it already does with `env.totalWeight`. The closure then adds it to
the lights' power. That is a new App-to-compiler parameter, so it waits for the owner's OK.

## Found by the independent review, left for later

These are gaps in the same area, but new rules rather than the listed bugs:

- **A key beside a named kind is ignored.** `{ blackbody: { kelvin: 3000 }, scale: 5 }`
  compiles and drops the scale. The other named kinds probably share this. Uniform checking of
  named-kind spellings belongs to the design note (one validator, B5).
- **Nothing checks that a slider's default lies within its authored min and max.** This holds
  for every `{param}`, not only blackbody. For example, `{param, default: 3, min: 5}` compiles.
  That would be a new rule in the shared slider check (`valueParamProblems`).
