# Khronos PBR Neutral tonemap — what it computes and why

The Khronos 3D Formats Working Group's neutral tone mapper (2024), designed for glTF
material preview. Unlike filmic curves, it aims to leave in-range colors **untouched** and
only compress what exceeds the display: a small dark-region offset, then above a
compression knee (`0.8 − 0.04`) it maps the channel peak through a hyperbola toward 1 and
desaturates gently toward that peak. Hue and (below the knee) saturation are preserved, so
what you see reads as the material's actual albedo — the right lens for judging material
correctness in a research tracer rather than for cinematic contrast.

Output is display-referred linear; the shared sRGB OETF encodes it. Transcribed from the
Khronos reference implementation.
