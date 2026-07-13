# Identity tonemap — what it computes and why

`c` unchanged: the display shows raw linear HDR, clipped by the display at 1.0.

Exists because the witnesses are stated in linear values — with `tonemap: 'none'` a
screenshot pixel IS the linear number (up to sRGB encoding of the framebuffer), so
furnace = 0.4 and F-ETA = 0.5540 can be read without inverting reinhard. Values above
1.0 clip; that's the point of having reinhard as the default and this as the
measurement view.
