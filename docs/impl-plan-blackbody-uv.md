# impl-plan-blackbody-uv — the blackbody lamp + the first Hit.uv reader

Owner-directed Jul 19 2026. Two small builds through existing doors; owner's framing
pinned: **blackbody is a PARAMETERIZATION** — kelvin → chroma is a pure function, so it
is a DERIVED value in the compiler's rail (u_tanFov/u_majorant pattern), never an
app-layer concern. The app just sees a float slider named Kelvin.

## 1. Blackbody emission

**Authoring:** a new SPECTRUM spelling for radiometric values —
`{ blackbody: { kelvin: Value<number>, scale?: Value<number> } }` — the lamp's two
physical dials: temperature and power. Legal wherever a SpectrumValue is; meaningful on
`emission` (lights and materials — a hittable blackbody lamp shares ONE derived uniform
between its sampler and its surface, the Stage-A discipline).

**Semantics (Model B, at the ONE split point):**
- constant kelvin+scale → FOLDS at plan entry to a plain Vec3 (`blackbodyRGB(k)·s`) —
  downstream plumbing sees an ordinary constant; zero new machinery runs.
- driven kelvin (or scale) → values.ts mints: the kelvin FLOAT slider (unit K, default
  range [1000, 12000]), the optional scale slider, and ONE derived vec3 uniform
  (`u_<kelvinPath>_rgb`, compute closure = `blackbodyRGB(kelvin)·scale`, bake ≡ ship).
  The CDF/power closures resolve it live (`resolveLightValues`), so a kelvin slider
  reshuffles light selection correctly.

**kelvin → RGB:** `components/lights/blackbody.ts` (family-root shared part, the
power.ts precedent): Planckian locus via the Kim et al. cubic approximations (CIE xy),
xy → XYZ (Y=1) → linear sRGB (D65), negatives clamped, **max-channel normalized** —
chroma carries color, `scale` carries ALL magnitude (the HDR-widget decomposition,
matching how emission is already edited). TS test pins sanity: ~6500K near-white,
2000K red-dominant, 12000K blue-dominant, blue/red ratio monotone in K.

**Touch points:** types.ts (spelling + guard) · Planner (constant folds at
resolveColorProperty + the light product; ResolvedProperty/LightRowValue admit the
driven spec) · values.ts (the split point) · lighting.ts resolveLightValues ·
Validator + propertyValidation (accept the spelling; validate kelvin default > 0 finite)
· materials.ts (emission special-case + isEmissive guards).

## 2. The first Hit.uv reader — `checker`

A real material occupant through the finished door: `components/materials/checker/`
(GLSL + descriptor + registry line). Lambert transport (cosine sampling, transcribed)
with `albedo = mix(albedo_a, albedo_b, checker(uv * scale))` — rows `albedo_a`,
`albedo_b` (Spectrum), `scale` (float, positive). This makes Hit.uv REAL: today's uv is
the placeholder planar xz chart (UV_PLANAR_SCALE) — the demo displays exactly that fact,
and per the audit disposition it forces the "which chart owns uv" design question for
the primitive descriptors (a per-primitive uv chart is the ledgered follow-up).
Kitchen-sink glslang coverage is automatic (it synthesizes from MATERIAL_MODELS).

## 3. Demo

One demo card: a checkered floor + spheres under a DRIVEN blackbody quad lamp
(`lamp.kelvin` slider 1000–12000 K + `lamp.power`) — both builds visible in one scene,
sliding kelvin live-recolors the light with zero recompiles.

Gates: tsc + vitest (blackbody TS test; kitchen sink; snapshots audited) + headless-lab
render check of the demo. Witness sweep = owner (means-neutral: new occupant + new
spelling, no existing-scene changes).
