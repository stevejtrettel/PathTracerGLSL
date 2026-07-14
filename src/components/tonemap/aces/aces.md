# ACES (Narkowicz) tonemap — what it computes and why

Krzysztof Narkowicz's one-function fit (2016) of the ACES RRT+ODT: a rational curve
`(x(ax+b))/(x(cx+d)+e)` that reproduces the filmic look of the full ACES pipeline at a
fraction of the cost. The workhorse filmic operator — strong highlight roll-off, rich
contrast.

Output is display-referred linear (the shared sRGB OETF encodes it). **Caveat:** the fit
skews saturated hues toward its primaries (bright reds→orange, etc.) — this is the known
ACES-fit artifact, and precisely why `agx` and `khronos` exist as hue-faithful choices.
