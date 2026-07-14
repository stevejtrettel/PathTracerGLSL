# AgX tonemap — what it computes and why

Troy Sobotka's AgX, Blender's default since 4.0. The pipeline: convert into a working
space and apply an **inset** matrix (desaturate slightly so extreme values don't clip to a
primary), **log2-encode** across a fixed EV window `[-12.47, 4.03]`, push through a
sigmoidal **contrast** curve (here a 6th-order polynomial approximation), then an
**outset** matrix restores saturation. The log-sigmoid is what gives AgX its signature
graceful highlight desaturation and hue stability — bright saturated sources march toward
white instead of hue-shifting (the ACES failure mode).

Transcribed from the widely-used "minimal AgX" (Benjamin Wrensch), sRGB working space. The
outset stage's `pow(2.2)` linearizes the result, so this occupant outputs display-referred
linear and the shared sRGB OETF re-encodes it.
