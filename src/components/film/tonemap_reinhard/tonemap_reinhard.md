# Reinhard tonemap — what it computes and why

`c / (1 + c)` per channel: a monotone map from linear HDR radiance [0, ∞) into
display range [0, 1), preserving order, compressing highlights smoothly instead of
clipping them.

View-section by definition (taxonomy §10): applied only at display, to the converged
linear quantity — the HDR export bypasses it, and every numeric witness (furnace 0.4,
F-ETA 0.5540) is stated in LINEAR values before this map. When checking a witness by
screenshot, invert it: display = sRGB(c/(1+c)), so linear 0.4 reads as ≈ 0.57 on
screen.

Per-channel (not luminance-normalized) — hue shifts near saturation are accepted for
v1 simplicity; ACES is the known next occupant if they start to matter.
