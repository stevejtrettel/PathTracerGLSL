# Hable (Uncharted 2) tonemap — what it computes and why

John Hable's filmic curve (2010), the operator that popularized filmic tone mapping in
games. A rational function with independently tunable toe (dark lift) and shoulder
(highlight roll-off), evaluated here at Hable's published constants, then normalized by the
curve's value at the white point `W = 11.2` (with his 2.0 exposure bias) so white maps to
1. Classic, contrasty; predates AgX/ACES-fit and is kept as a reference filmic.

Output is display-referred linear; the shared sRGB OETF encodes it.
