// Spectrum helpers for media — included by core iff the program has media (commit D of
// the item-9 split: conditional INCLUSION replaced the HAS_MEDIA preprocessor gate).
Spectrum spectrum_exp(Spectrum s) { return exp(s); }   // Beer–Lambert per channel (§2.5: named, no ad-hoc exp(vec3))
