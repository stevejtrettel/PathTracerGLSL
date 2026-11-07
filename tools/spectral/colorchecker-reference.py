# Reference linear sRGB of the 24 ColorChecker patches (BabelColor average) under CIE D65, by
# colour-science, an implementation independent of this renderer: sd_to_XYZ with its default
# method (ASTM E308) and the CIE 1931 2° observer, then XYZ to linear sRGB at the sRGB white.
# tests/components/measured.test.ts holds the printed values.
#
#   python3 -m venv <dir> && <dir>/bin/pip install colour-science==0.4.4
#   <dir>/bin/python -I tools/spectral/colorchecker-reference.py <spectra root>
#
# <spectra root> is the download of docs/claude-2026-11-review/spectral-data-sources.md; the
# script checks that colour-science's patches equal the JSON extract colors.ts was made from.

import json, sys
import colour

sds = colour.SDS_COLOURCHECKERS['BabelColor Average']
extract = json.load(open(f'{sys.argv[1]}/colour-science/json/characterisation__colour_checkers__sds__DATA_BABELCOLOR_AVERAGE.json'))
cmfs = colour.MSDS_CMFS['CIE 1931 2 Degree Standard Observer']
d65 = colour.SDS_ILLUMINANTS['D65']
srgb = colour.RGB_COLOURSPACES['sRGB']
for name, sd in sds.items():
    assert all(abs(sd[float(k)] - v) < 1e-12 for k, v in extract[name].items()), name
    rgb = colour.XYZ_to_RGB(colour.sd_to_XYZ(sd, cmfs, d65) / 100, srgb, illuminant=srgb.whitepoint, apply_cctf_encoding=False)
    print(f"    '{name}': [{', '.join(f'{c:.5f}' for c in rgb)}],")
