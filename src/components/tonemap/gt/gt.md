# Gran Turismo (Uchimura) tonemap — what it computes and why

Hajime Uchimura's curve (2017), presented for Gran Turismo. Its distinguishing feature is
an **explicit linear midsection**: a power-function toe, a straight linear region (so
mid-tones pass through with controllable contrast and no unwanted S-curve compression),
and an exponential shoulder to the max-brightness `P`. The three regions are blended by
`smoothstep`/`step` weights. Parameters (contrast `a`, linear start `m`, linear length `l`,
black tightness `c`, pedestal `b`) are at Uchimura's defaults here; they are the natural
future dials if this becomes a tunable occupant.

Per-channel. Output is display-referred linear; the shared sRGB OETF encodes it.
