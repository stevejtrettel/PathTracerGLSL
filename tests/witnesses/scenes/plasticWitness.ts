// tests/witnesses/scenes/plasticWitness.ts
// The plastic occupant (smooth coat over Lambert) under the open furnace: a convex sphere in a
// constant samplable sky L = 1. Every scattered ray escapes, so a sphere pixel reads the
// directional albedo A(μ) = F(μ) + (1 − F(μ))·R(1 − K)/(1 − R·K) exactly (plastic.md), with
// μ the camera ray's cosine. Values for coat_eta 1.5 (K = 0.5963457597, F(1) = 0.04):
//   - R = 1: A ≡ 1 at every μ, so the whole frame (sky and sphere) reads 1.
//   - R = (0.8, 0.5, 0.2): A(1) = (0.632833, 0.316071, 0.127997). The furnace-sky center region
//     sees μ ≥ 0.978, where A moves by < 3e-5.
//   - spectral-mirror's camera (fov 0.2 at distance 4, whole frame, μ ≥ 0.828) over gray 0.5:
//     the frame mean of A is 0.316313. Gray is not lifted through the RGB table, so the
//     spectral value is the RGB one.
// What these cannot see: the direction of the mirror lobe (any escaping direction reads 1).

import type { SceneDescription } from '../../../src/compiler/types.js';
import { furnaceSkyScene } from './envScenes.js';

export const plasticFurnaceScene: SceneDescription = {
    ...furnaceSkyScene,
    id: 'plastic-furnace',
    name: 'Plastic furnace (white base under a 1.5 coat: A ≡ 1)',
    materials: { gray: { model: 'plastic', albedo: 1, coat_eta: 1.5 } },
};

export const plasticChromaScene: SceneDescription = {
    ...furnaceSkyScene,
    id: 'plastic-chroma',
    name: 'Plastic chroma (base (0.8, 0.5, 0.2) under a 1.5 coat)',
    materials: { gray: { model: 'plastic', albedo: [0.8, 0.5, 0.2], coat_eta: 1.5 } },
};

export const spectralPlasticScene: SceneDescription = {
    ...furnaceSkyScene,
    id: 'spectral-plastic',
    name: 'Spectral plastic (gray 0.5 base under a 1.5 coat)',
    materials: { gray: { model: 'plastic', albedo: 0.5, coat_eta: 1.5 } },
};

/** A(1) per channel for R = (0.8, 0.5, 0.2), coat_eta 1.5. */
export const PLASTIC_CHROMA_CENTER: [number, number, number] = [0.632833, 0.316071, 0.127997];
/** The frame mean of A for gray 0.5 under spectral-mirror's camera. */
export const SPECTRAL_PLASTIC_FRAME = 0.316313;
