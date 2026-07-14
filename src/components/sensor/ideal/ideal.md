# Ideal sensor — what it computes and why

The identity importance: `We(film, ω) = 1`. A pixel measures `I_j = ∫ h_j · We · L`; with
`We ≡ 1` this is just the average radiance the tracer already computes — so the occupant
exists to make the **seam** real (a `sensor_response` the measurement pipeline calls),
not to change any number. `We·L == L` bit-for-bit, which is the carve's correctness proof.

It's the adjoint of a light's `Le`: the same object a bidirectional/light-tracing method
would carry backward from the sensor. `film` (the film-plane point) and `ray_dir` (the
generated direction) are the arguments a real sensor needs — exposure and cosⁿ vignetting
key off them, and a spectral response would key off wavelength once that's a seed field.
