# Measured spectra: what was downloaded, and from where

Downloaded 2026-11-06. Root: `/Users/stevetrettel/Code/PathTracerGLSL/public/trial/spectra/` (gitignored, `public/trial/`).
Total 213 MB, 7,755 files. Licenses were not looked at, as instructed.
Converted copies (JSON) were made with scripts kept outside the repo, in
`/private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/scripts/`.
Nothing outside `public/trial/spectra/` was changed.

## 1. refractiveindex.info database: metal eta/k, glasses, plastics, water (`refractiveindex-info/`)
- Source: https://github.com/polyanskiy/refractiveindex.info-database (whole repo, branch `main`, commit e6d15e364f70de1cad8a96a20f75689f2fba8b21), zip from https://codeload.github.com/polyanskiy/refractiveindex.info-database/zip/refs/heads/main
- Local: `refractiveindex-info/database-main/database/data/**.yml` (4,182 YAML files, 56 MB). Index: `database-main/database/catalog-nk.yml`.
- Format: YAML. `tabulated nk` = rows of (wavelength in µm, n, k), or `formula N` with coefficients (Sellmeier and similar) and a validity range.
- Metals (checked): Au/Ag/Cu `main/<X>/nk/Johnson.yml` (Johnson & Christy 1972, 0.188–1.937 µm, 49 points spaced evenly in photon energy, so about 20 in the visible); also McPeak, Babar, Werner, Rakic and others.
  Al: `main/Al/nk/Rakic.yml` (206 points, 0.12 nm–200 µm), `McPeak.yml` (0.15–1.7 µm, 297 points). Fe, Cr, Ti, Ni, Co: `Johnson.yml` (Johnson & Christy 1974, same 49-point grid). Pt, Zn, W, Pd, Mo, Ta, V, Pb, Sn, Mg also present.
  Brass: `other/alloys/Cu-Zn/nk/Querry-Cu70Zn30.yml` (0.21–55.6 µm, 611 points), plus Cu85Zn15 and Cu90Zn10. Au–Ag alloys at 10% steps: `other/alloys/Au-Ag/nk/Rioux-*.yml`.
  **No stainless steel** in the database (searched file paths for steel/stainless). Fe and Cr are the closest.
- Glasses: `specs/schott/optical/*.yml` (Schott catalog as Sellmeier formulas, e.g. N-BK7 0.3–2.5 µm, N-SF11, N-LASF9, N-BAF10, F2), plus `specs/{ohara,hoya,cdgm,sumita,hikari,…}`. Window glass: `glass/misc/soda-lime/`.
- Also present: `main/H2O/nk/` (Hale, Daimon, …), polymers under `organic/` (PMMA, polycarbonate, polystyrene, PET, PE, PDMS), and gemstones and minerals under `main/` (Al2O3, SiO2, CaCO3, TiO2, ZnO, C (diamond), …).

## 2. pbrt-v4 named spectra (`pbrt-v4/`)
- Source: https://raw.githubusercontent.com/mmp/pbrt-v4/master/src/pbrt/util/spectrum.cpp (commit b0bdf461ba5dd6504b70ebf0932acc0fe7aa744f)
- Local: `pbrt-v4/spectrum.cpp` (original) and `pbrt-v4/pbrt_named_spectra.json` (extracted: `{name: {lambda_nm[], value[]}}`, 97 arrays).
- Contents: metal eta/k for Ag, Al, Au, Cu (298.8–885.6 nm, 56 points), CuZn brass (290–890 nm, 10 nm step, 61 points), MgO and TiO2. Glass eta for BK7, BAF10, FK51A, LASF9, SF5, SF10, SF11 (~290–916 nm, about 26–29 points; the file's comment credits refractiveindex.info). Illuminants A, D50, D65 and ACES D60 (300–830 nm, 5 nm) and F1–F12 (380–780 nm, 5 nm). Camera RGB sensitivities (Canon, Nikon, Sony, Hasselblad; 380–720 nm, 10 nm; PhysLight/Weta).

## 3. CIE official data tables (`cie/`)
- Source pages: https://cie.co.at/data-tables; files from `https://files.cie.co.at/Publications-datasets/<name>`
- Format: CSV with no header, wavelength in the first column.
- `CIE_std_illum_A_1nm.csv`, `CIE_std_illum_D65.csv`, `CIE_std_illum_D50.csv`: 300–830 nm, 1 nm
- `CIE_illum_C.csv`, `CIE_illum_D55.csv`, `CIE_illum_D75.csv`, `CIE_illum_ID50.csv`, `CIE_illum_ID65.csv` (indoor daylight): 300–780 nm, 5 nm
- `CIE_illum_Dxx_comp.csv`: daylight basis S0, S1, S2, 300–830 nm, 5 nm
- `CIE_illum_FLs.csv` (5 nm) and `CIE_illum_FLs_1nm.csv` (1 nm): 380–780 nm, 27 lamps (FL1–FL12 and FL3.1–FL3.15)
- `CIE_illum_LEDs.csv` (5 nm) and `CIE_illum_LEDs_1nm.csv` (1 nm): 380–780 nm, 9 LEDs (LED-B1…B5, BH1, RGB1, V1, V2; CIE 015:2018)
- `CIE_illum_HPs.csv`: 5 high-pressure discharge lamps, 380–780 nm, 5 nm
- Reflectances: `CIE_srf_cri.csv` (14 CRI test samples, 360–830 nm, 5 nm); `CIE_srf_cfi_1nm.csv` (99 CFI test samples, CIE 224:2017, 380–780 nm, 1 nm. From memory, not checked here: these are real objects, including natural materials, skin, textiles, paints, plastics and print); `CIE_srf_CQS_5nm.csv` (15 CQS samples); `CIE_srf_PS_5nm.csv` (Japanese skin, 1 sample)
- `CIE_xyz_1931_2deg.csv`: the CIE 1931 2° color-matching functions, 360–830 nm, 1 nm (downloaded for reference)

## 4. colour-science package datasets (`colour-science/`)
- Source: https://github.com/colour-science/colour (branch `develop`, commit 9072a98d04e048fe0ea2b1e3aa8429d6e95d37b6), raw files from `https://raw.githubusercontent.com/colour-science/colour/develop/colour/<path>`; local filename = path with `/` → `__`.
- Originals (`.py`, plus one CSV) and JSON extracts in `colour-science/json/` (`{name: {wavelength: value}}`).
- ColorChecker 24, `characterisation/datasets/colour_checkers/sds.py`: **BabelColor average** (24 patches, 380–730 nm, 10 nm), **ColorChecker N Ohta 1997** (24 patches, 380–780 nm, 5 nm), **PMC** "preferred memory color" chart (30 patches, 400–700 nm, 10 nm: 4 skin tones; foods: pork, carrot, orange, banana, green apple, purple cabbage; summer grass, blue sky, lavender, grays).
- Illuminants, `colorimetry/datasets/illuminants/sds.py`: 52 CIE illuminants (A, B, C, D50–D75, E, FL1–FL12, FL3.1–3.15, HP1–5, LED-B1–B5, BH1, RGB1, V1, V2, ID50, ID65), 300–780 nm, 5 nm (A is listed this way), and 7 ISO 7589 illuminants.
- Real lamps, `colorimetry/datasets/light_sources/sds.py`: NIST traditional (10: cool white FL, daylight FL, HPS, incandescent, LPS, mercury, metal halide, neodymium incandescent, super HPS, triphosphor FL), NIST LED (15), NIST Philips (22 named lamps), RIT (8), and Kinoton 75P. 380–780 nm, 5 nm.
- Sun: `plotting/datasets/astm_g_173.py`, ASTM G-173 solar spectra (extraterrestrial, global tilt, direct+circumsolar; 280–4000 nm, 2,002 points).
- `quality/datasets/tcs.py` (CIE 1995 TCS01–14; its CIE 2024 table could not be extracted to JSON. Use `cie/CIE_srf_cfi_1nm.csv` instead), `quality/datasets/vs.py` (CQS VS1–15), `quality/datasets/tlci2012.py` (24 TLCI test colors).
- `characterisation/datasets/rawtoaces/190_Patches.csv`: 190 reflectances used for training camera IDTs, 380–780 nm, 5 nm. `characterisation/datasets/aces_it.py`: ACES RICD.

## 5. colour-science Zenodo mirrors, including the UEF/Joensuu spectral database (`zenodo-colour-datasets/`)
The UEF site itself (https://sites.uef.fi/spectral/) returned HTTP 403. These are the colour-science community's mirrors of the same data. Each folder has the original README.txt and urls.txt.
- `3269912-…Munsell-Colors-Matt…/munsell380_800_1.asc`: **1,269 matt Munsell chips**, 380–800 nm, 1 nm, a single column of 421 values per chip. The chip index is at the end of README.txt. https://zenodo.org/records/3269912
- `3269918-…Munsell-Colors-Glossy-All…/munsell380_780_1_glossy.asc`: **1,600 glossy Munsell chips**, 380–780 nm, 1 nm (401 rows × 1,600 columns); chip names in `names.xls`. https://zenodo.org/records/3269918
- `3269924-Lumber-Spectra/lumber380_2700_1/*.asc`: **wood**: pine, spruce, aspen and birch, clear wood (`Wp`) and knots (`Wb`); 272 spectra, 380–2700 nm, 1 nm. README: values are relative (measured against a mirror with an 87.25% attenuating filter), not absolute reflectance. https://zenodo.org/records/3269924
- `3269920-Forest-Colors/forest380_850_5/{birch,pine,spruce}.dat`: **foliage** (birch leaves, pine and spruce needles); 337 + 370 + 349 spectra, 390–850 nm, 5 nm (93 values each). https://zenodo.org/records/3269920
- `3269922-Paper-Spectra/paper400_700_10/*.asc`: paper, newsprint, cardboard (SCI/SCE) and a mirror, 400–700 nm, 10 nm. https://zenodo.org/records/3269922
- `3269926-Agfa-IT8-7-2-Set/agfait872.dat`: Agfa IT8.7/2 photographic-print target, 288 patches (format in README). https://zenodo.org/records/3269926
- `4051012-Measured-Commercial-LED-Spectra/led_spd_350_700.csv`: **29 commercial LEDs** (Brendel 2020), 350–700 nm, 2 nm (176 columns). https://zenodo.org/records/4051012
- `4642271-…Cine-Lighting/OFTP_full-sample-package_v2/*.csv`: **film lights** (Arri tungsten, HMI and LED; Bron Kobold HMI and FL; Kino Flo; Dedolight), absolute and normalized; lamp metadata in `lamp-measurement-information.csv` (semicolon-separated). Karge et al. 2015. https://zenodo.org/records/4642271
- `3245875-Labsphere-SRS-99-020/SRS-99-020.txt`: Spectralon 99% white reference. https://zenodo.org/records/3245875
- File URLs: `https://zenodo.org/api/records/<id>/files/<key>/content`. `.gz`, `.tar.gz` and `.zip` files were unpacked in place.
- Not downloaded: MATLAB `.mat` duplicates, Jakob–Hanika coefficient tables (37 MB, record 4050598), the Prague sky model (3 GB, record 19140728), the PhysLight camera curves (already in pbrt-v4).

## 6. USGS Spectral Library v7 (`usgs-splib07/`)
- Source: ScienceBase child item "Spectra of materials in ASCII format", https://www.sciencebase.gov/catalog/item/586e8c88e4b0f5ce109fccae, file `ASCIIdata_splib07b_cvASD.zip` (28 MB, unpacked to 110 MB). Parent item: https://www.sciencebase.gov/catalog/item/5807a2a2e4b0841e59e3a18d (DOI 10.5066/F7RR1WDJ, Data Series 1035).
- Version: "splib07b convolved to ASD": every spectrum on one common grid, 350–2500 nm at 1 nm (2,151 channels; grid in `s07_ASD_Wavelengths_ASD_0.35-2.5_microns_2151_ch.txt`, in µm).
- Format: one text file per spectrum, a title line, then one value per line. `-1.23e34` means no data.
- Local: `usgs-splib07/ASCIIdata_splib07b_cvASD/Chapter*/`. File counts: A artificial 290, C coatings 12, L liquids 24, M minerals 1,276, O organic compounds 360, S soils 209, V vegetation 286; plus 680 error-bar files.
- Useful for pictures: **paints and pigments** (cadmium red, orange and yellow; vermillion, ultramarine, Prussian blue, viridian, cobalt blue, green and violet; phthalo blue, titanium white, lead white, zinc oxide; ochre, sienna, umber, burnt sienna), **brick** (7), concrete, cinder block, asphalt, roof shingles, **wood** (cedar shake, plywood, pine 2×4, particle board, OSB), **plastics** (HDPE, LDPE, PETE, PVC, vinyl, ABS, polystyrene, Tyvek, tarps), **fabrics** (cotton, burlap, nylon, polyester, terrycloth, carpet), cardboard, paper, galvanized and painted metal, a rusted tin can, brushed aluminum, Spectralon, **foliage and flowers** (aspen, maple, conifer needles, lawn grass, dry grass, lichens, cactus, geranium, pansy, petunia, platycodon), snow, ice, seawater, soils, and minerals.
- Not downloaded: the full release `usgs_splib07.zip` (5.5 GB); `ASCIIdata_splib07a.zip` (21.8 MB, native instrument resolution on mixed grids); other sensor-convolved versions.

## 7. BabelColor ColorChecker (`babelcolor/`)
- Source: https://www.babelcolor.com/index_htm_files/ColorChecker_RGB_and_spectra.zip
- Local: `babelcolor/ColorChecker_RGB_and_spectra/ColorChecker_RGB_and_spectra.xls` (Excel). BabelColor average ColorChecker spectra and RGB values; the sheet was not opened here. The same average is in colour-science as BABELCOLOR_AVERAGE (380–730 nm, 10 nm).

## 8. LSPDD, Light Spectral Power Distribution Database (`lspdd/`)
- Site: https://lspdd.org (a JavaScript app). The data came from its JSON API: lamp list https://api.lspdd.sbcloud.ca/lamp, each capture from `https://api.lspdd.sbcloud.ca/capture/<id>`.
- Local: `lspdd/lamps.json` (311 lamps with metadata: brand, type, CCT, watts, lm/W), `lspdd/captures/<id>.json` (311 raw responses), and `lspdd/lspdd_all_spectra.json` (307 spectra with data, combined: name, category, lamp type, brand, CCT, `lambda_nm[]`, `value[]`).
- Contents: LED 152, incandescent 46, halogen 30, CFL 28, metal halide 4, HPS 2, sun 1, plus 38 "Standard Illuminant" and 6 "Biological Sensitivity" entries that are not lamps. Mostly 380–780 nm at 0.5 nm (801 points); some at 5 nm. Values are relative.

## Not obtained
- **ECOSTRESS spectral library** (https://speclib.jpl.nasa.gov/download): requires a request form, and individual files cannot be reached. Its man-made, vegetation and NPV classes overlap the USGS library above.
- **UEF/Joensuu site directly**: 403. The Munsell, forest, lumber and paper sets came from the Zenodo mirrors.
- **PROSPECT** (leaf) is a procedural model, not data. Nothing was downloaded.
- **Stainless steel** n,k: not in refractiveindex.info. pbrt-v4 has no steel either.

## Do measured reflectances look different from a smooth Jakob–Hanika uplift of the same RGB?
Nothing measured here. These are literature findings only.
- In principle, yes, under non-daylight light. Any smooth uplift picks one metamer per RGB. A measured spectrum is a different metamer, so the two can match under D65 and differ under spiky light (F-series, LED, sodium). Jakob & Hanika 2019 (https://rgl.epfl.ch/publications/Jakob2019Spectral) optimize color error under the reference illuminant only. The search found no published ΔE between a measured ColorChecker and its J–H uplift under F11, LED or illuminant A.
- Tódová, Wilkie & Fascione, "Moment-based Constrained Spectral Uplifting" (EGSR 2021, https://cgg.mff.cuni.cz/publications/moment-based-constrained-spectral-uplifting), and the 2022 wide-gamut follow-up are motivated by this effect: they constrain the uplift to hit measured spectra for chosen colors (e.g. ColorChecker patches) and compare photos under daylight and fluorescent light in a viewing booth. Search summary; the paper text was not read.
- Belcour, Barla & Guennebaud, "One-to-Many Spectral Upsampling of Reflectances and Transmittances" (CGF/EGSR 2023, https://arxiv.org/abs/2306.11464): explores the set of spectra that give one RGB, for metamerism effects (the abstract was read).
- van de Ruit & Eisemann, "Controlled Spectral Uplifting for Indirect-Light-Metamerism" (SIGGRAPH Asia 2024): found by title only, not read.
- The data downloaded makes this easy to measure directly: Ohta or BabelColor ColorChecker and the 1,269 matt Munsell chips, each against its own J–H uplift (the colour-science `colour.recovery` module implements J–H), compared under `cie/CIE_illum_FLs_1nm.csv` (FL2, FL11), `CIE_illum_LEDs_1nm.csv` and illuminant A.
