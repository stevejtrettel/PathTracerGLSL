# Check of primitive-bodies

What I did:
- Re-ran every script with `npx tsx` from the repo root: ball, shapes, frame_precision, torus_bound, lipschitz, march, tetra_e3 and asinh_neg. Every number quoted in notes.md and in the summary reproduced exactly.
- Read each cited source line.
- Re-derived these by hand: the H³ and S³ ball identities, the plane roots, the plane and box face normals, the tube quadratic in e^{2t}, the S³ double-angle form, the Lambert corner angle, the Klein and gnomonic area densities, and the order of the 4-tap stencil.
- Wrote one independent script, `check/frame_far_camera.ts`.

## Verified (no change needed)

- **H³ ball.**
  - [math, re-derived] The two identities hold: a²−b² = 1+|P×V|², which gives discriminant sinh²R−|P×V|². The smaller root equals (a−b)/(C+√D).
  - [math] The S³ form is right: A² = 1−|P×V|² and α = atan2(√(sin²R−k), cos R).
  - [checked-num ball.ts] 0 mismatches; max |Δt| was 1.06e-11 in H³ and 8.9e-16 in S³.
- [math] **Plane roots.** e^{2t} = (W−P)/(W+P), and t = mod(atan(−P,W), π). The H³ and S³ offset normals are unit vectors and orthogonal to the offset point.
- [math] **Box.** The face normals and the dihedral cos = sinh hᵢ sinh hⱼ are right. The Klein box condition Σtanh² < 1 is right. For the quad, tanh²a+tanh²b < 1 is equivalent to sinh a sinh b < 1.
- [math] **Tube.** The quadratic αy²+(2β−sinh²r)y+γ = 0 and the S³ form M + A cos(2t−ψ) are right.
- [checked-num torus_bound.ts] **Torus bound.** The E³ bound fails in S³ (13655 of 40000 points outside) and is valid in H³. The tight half-heights also hold.
- [checked-num tetra_e3.ts] **4-tap stencil is first order.** Errors 1.49e-3 vs 2.23e-6 at h = 1e-3; the 4-tap error scales as h. [math] Σkₓk_yk_z = 4·0.5773³ ≠ 0, so the h² term survives. The comment at src/components/geometry/index.ts:336 is wrong.
- **Citations that are correct:** index.ts:234 (`ray.origin + t*ray.direction`), march.glsl:12 and :20, torus.ts:24-30.

## Corrections

1. **Wrong citation: descriptors.ts:108.** [checked-code] That line is `MaterialModelDescriptor.glsl`. `PrimitiveDescriptor` is at src/components/descriptors.ts:380, and its `glsl: string` is at :390.
2. **Wrong citation: custom.ts:75.** [checked-code] Line 75 is the defineSDF doc comment. The vec3 signature is documented at src/components/geometry/custom.ts:33 and enforced by regex at :115-116.
3. **Disk and quad hits are not brute-force checked.** The summary says ball, plane, disk, quad, box and cylinder "all matched brute force with 0 mismatches". shapes.ts tests only the disk and quad areas, the quad corner angle and the edge residual. It has no hit-versus-brute-force test for them. Disk and quad intersection should be labeled [math]; it is trivial (a plane hit plus a membership test).
4. **"Exists only when R + r < π/2" is mislabeled.** torus_bound.ts only skips that case and prints the claim; it tests nothing. The label should be [math].
5. **asinh wording overstates.** The summary says "GLSL's asinh is built from log(x+√(x²+1))". The spec, from memory, only defines the *allowed precision* as inherited from that formula. Drivers may do better. The recommendation, sign(x)·asinh(|x|), is still right and costs nothing.
6. **Frame-precision finding needs context; the open question is framed on the wrong variable.**
   - **(a) Practical scale.** "Wrong %" counts only rays in the ±10% silhouette band. For the cases where the object frame failed, the misclassified band is 3e-6 to 6e-6 rad (R=0.1 d=6: 3.4e-6; R=0.1 d=8: 6.2e-6; R=0.01 d=6: 2.9e-6). A pixel is about 1e-3 rad, so this is about 0.5% of a pixel, on objects that are already sub-pixel. [math: arithmetic on the agent's measured rates, printed by check/frame_far_camera.ts]
   - **(b) What actually degrades.** In frame_precision.ts the camera sits exactly at the world origin. My test, check/frame_far_camera.ts, used the object-frame scheme with the world ray stored in f32 and the camera at world distance D from the origin. Camera rays only.

     | Ball radius R | Camera-to-object distance d | Camera at world distance D | Wrong band |
     |---|---|---|---|
     | 0.1 | 1 | 0 | 0% |
     | 0.1 | 1 | 3 | 0.07% |
     | 0.1 | 1 | 6 | 13%, about 2.2e-3 rad (about 2 px) |
     | 0.1 | 3 | 6 | 46%, about 9e-4 rad |
     | 1 | 3 | 6 | 25%, about 6e-3 rad (about 6 px) |

     So the visible float32 risk comes from large world coordinates, meaning ray origins far from the world origin. It does not come from object frame versus ray frame. [checked-num check/frame_far_camera.ts] The rows with R = 1 and d = 1 put the camera on the ball and should be ignored.
   - **(c) The ray-frame scheme is not general.** "Ray-origin frame" works without extra machinery only when the ray starts at the world origin. A general ray needs a per-ray boost, composed in f32 with each object's placement. That again multiplies two large matrices. [math, not measured]

   **Correction:** drop the claim that this "bears on decision 9(1)", and replace the open question with this one: "how far from the world origin can ray origins sit before f32 fails, and does the design need to keep the world frame near the camera?" This is untested; I am not recommending any fix.
7. **Over-engineering: torus bound.** A ball of radius R+r around the center is a valid bound in all three spaces by the triangle inequality [math]. That means no per-space cap formulas and no R+r < π/2 validation, so it should be listed as the simpler option. The torus.ts:19-23 comment explains why E³ chose the tight cylinder: the ball wastes march steps on grazing rays. That is the owner's trade-off. Also note that the E³ values are valid in H³, so only S³ actually needs different numbers.
8. **Over-engineering: FD normals and the tangent frame.** All native shapes, the torus included, have analytic normals, and the exotic fields are proposed as compile errors. So the first subset needs no curved-space finite-difference normal and no tangent-frame stencil. This should be stated as "not needed for the first subset" rather than as machinery to build.
9. **Two box intersectors where one would do.** The table proposes the slab method in τ = tanh t for H³, and candidate roots for S³. §7.5 then praises candidate roots as one pattern for all spaces. Pick one. Candidate roots (tested in both spaces) gives fewer code paths.
10. **The "SDF shapes" part of the subset is left thin.** Decision 9(2) names "SDF and analytic shapes". With menger, apollonian, bottle, knob and defineSDF as compile errors, the only marched shape left is the torus. The notes should say so plainly. They should also say whether a per-space defineSDF (a vec4 signature) is in or out of the first subset, since that is the owner's call.
11. **Bit-identical E³ is not addressed.** The flow-seam change at index.ts:234 and any march_epsilon change would alter E³ shader text unless the E³ seam expands to the identical expression. This needs a digest before/after (`npm run digest`) in the plan. The per-space body map leaves E³ bodies untouched, which is good, but the notes do not say it.
12. **Minor sketch edge cases.**
    - H³ plane: W+P = 0 (an asymptotically parallel ray) divides by zero, giving an infinite t that passes the "> 1" test. A far-limit compare is needed.
    - S³ ball and plane: t = 0 from mod when starting on the surface. That is the same self-hit issue as E³.

## Verdict

The math is sound and the numbers reproduce. Two citations are wrong (corrections 1 and 2), and two items are mislabeled as checked (corrections 3 and 4).

The headline precision finding is numerically right but practically sub-pixel. It also points at the wrong variable: my independent test shows that f32 failure is driven by ray origins far from the world origin, not by object frame versus ray frame. The open question against decision 9(1) should be reworded as in correction 6, not used to cast doubt on the decision.

The simplicity flags are corrections 7–10: use a ball bound for the torus, drop FD normals from the first subset, keep one box intersector, and state plainly what "SDF shapes" means in the subset.
