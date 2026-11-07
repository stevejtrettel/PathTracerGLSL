# Review: measured spectra (sources.md)

Reviewed 2026-11-06 against the files in `public/trial/spectra/` and the repo.

## Scope

There is no `plan.md` in this folder. That fits the owner's request ("just grab the spectra and
report the sources"): nothing was asked to be designed or built. So the plan-level checks
(simplicity of a design, fit with the spectrum-kind contract, RGB stand-in and white point,
WebGL2 feasibility, whether a verification can fail) have nothing to check. This review checks
`sources.md` against the downloaded files.

Repo state (checked): `git status` is the same as at session start. `public/trial/` is gitignored
(.gitignore:35). The download is 213 MB and 7,755 files, as stated.

## Errors in sources.md (checked against the files)

1. **Stainless steel is in refractiveindex.info.** The statement "No stainless steel" is wrong. It
   appears in section 1 and again under "Not obtained". The files are
   `data/other/alloys/stainless steel/nk/Karlsson-austenitic.yml` and `Karlsson-ferritic.yml`
   (Karlsson & Ribbing 1982, tabulated n,k, 0.20–2.50 µm, 116 points, 21 of them in 380–780 nm).
   `catalog-nk.yml` lists them at line 5559 (BOOK `stainless_steel`). The directory name contains
   a space, which is probably why the path search missed them.
2. **pbrt-v4 extract: 88 arrays, not 97.** `pbrt_named_spectra.json` has 88 entries. spectrum.cpp
   declares 89 `Float x[]` arrays, and one of them is the `wls` helper. So the extract is complete;
   the count in the text is wrong.

## Small inaccuracies

3. Johnson & Christy grid: "about 20 in the visible" should be **14** points in 380–780 nm
   (counted for Au; Fe uses the same grid).
4. Zenodo: "Each folder has the original README.txt and urls.txt" is not true for every folder.
   `3245875-Labsphere-SRS-99-020/` has neither file, and `4051012-…LED…/` has no README.
5. colour-science CIE illuminants "300–780 nm, 5 nm" holds for A, B, C and the D series. The FL,
   HP and LED entries are 380–780 nm.
6. Parsing note: `cie/CIE_srf_CQS_5nm.csv` and `cie/CIE_srf_PS_5nm.csv` begin with a UTF-8 BOM.
   The other CIE files do not.

## Checked and correct

- refractiveindex.info: 4,182 YAML files (4,180 data files + 2 catalogs), 56 MB. Point counts and
  ranges are as stated: Au and Fe Johnson 49 points, 0.188–1.937 µm; Al Rakic 206 points; Al
  McPeak 297 points, 0.15–1.7 µm; Querry Cu70Zn30 611 points, 0.21–55.6 µm. Also present: Rioux
  Au–Ag, Schott, soda-lime, and the listed polymers.
- pbrt-v4: metals 56 points (298.8–885.6 nm), CuZn 61 points (290–890 nm), glasses 26–29 points,
  illuminants and F1–F12, camera curves 35 points (380–720 nm).
- CIE: every file's range, step and column count matches the text (FLs 27 lamps, LEDs 9, HPs 5,
  CRI 14, CFI 99, CQS 15, xyz 360–830 nm).
- colour-science: BabelColor 24 patches (380–730 nm, 10 nm); Ohta 24 (380–780 nm, 5 nm); PMC 30
  (400–700 nm, 10 nm); 52 CIE + 7 ISO illuminants; NIST light sources 10 traditional, 15 LED and
  22 Philips; RIT 8; ASTM G-173 2,002 points; 190 patches (380–780 nm, 5 nm).
- Zenodo: matt Munsell 1,269 × 421; glossy Munsell 401 × 1,600; forest 337/370/349 × 93; lumber
  272 spectra × 2,321 channels; README text on the 87.25 % filter; LED CSV 176 wavelength columns
  (350–700 nm, 2 nm), 29 rows.
- USGS: chapter counts 290/12/24/1,276/360/209/286, 680 error-bar files, a title line followed by
  2,151 values, and the −1.23e34 no-data marker.
- LSPDD: 307 spectra; category counts match. 256 have 0.5 nm steps, 37 have 5 nm, and 8 have 1 nm.

The literature section is labeled as a search summary that was not measured, and that label is
correct. "The search found no published ΔE…" is an absence claim from a search, and should be
read as such.

## Not must-fix (outside the "just grab" scope)

- The spectra were fetched by hand. They are not in `tools/trial-assets.json` and
  `tools/fetch-trial-assets.mjs`, which are Poly Haven-only. A fresh clone can rebuild them only
  by following sources.md, which does record the commits and URLs.
- Vite copies `public/` into `dist/` on `vite build`, so a local build would include the 213 MB.
  CI does not build.
- For any later plan to use this data, these facts were checked: the spectrum kinds are rgb,
  blackbody, cauchy, sellmeier and gaussian. There is no tabulated kind, the index role is a
  single positive real, and there is no conductor material (materials: lambert, ggx, mirror,
  dielectric, rough_dielectric, checker). Using the metal n,k or measured reflectances in the
  renderer would therefore need a plan of its own.

## Verdict

As a download-and-report task, sources.md is accurate except for items 1 and 2. Fix those two;
items 3–6 are one-line corrections.
