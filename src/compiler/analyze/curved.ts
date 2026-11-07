// compiler/analyze/curved.ts
// Who implements what, per ambient space.
//
// An occupant with GLSL supports a space exactly when it has a body for it (descriptors.ts
// SpaceBodies); an estimator occupant whose code is emitted from TypeScript lists its spaces
// (SpaceList). The Validator checks both at its registry gates with `spaceGate`, the one
// message. Features that have no descriptor are rows of SPACE_LIMITATIONS, checked by
// `curvedLimitations` together with the estimator occupants the program resolves to (after
// defaults). Shared files without a descriptor (ray.glsl, the shadow walkers, microfacet.glsl)
// are in neither: the curved-space witnesses establish them.

import type { RenderStrategy, SceneDescription } from '../types.js';
import { isInstancedObject, isMeshObject, isPrimitiveObject, mediumIsDeflecting, sceneRoutesToTracking } from '../types.js';
import type { SceneFeatures } from './types.js';
import type { SpaceList } from '../../components/descriptors.js';
import { LIGHT_SELECTIONS, DEFAULT_LIGHT_SELECTION } from '../../components/lights/index.js';
import { MESH_TRAVERSALS, INSTANCE_ACCELS, OBJECT_DISPATCHES, DEFAULT_MESH_TRAVERSAL, DEFAULT_INSTANCE_ACCEL } from '../../components/intersection/index.js';
import { sampledEmitterObjects, objectDispatchOf, marchedObjectCount, materialReadsUv } from '../plan/dataTenants.js';

/** The message for an occupant that has no implementation in the program's space, or null
 *  when it has one. `occupant` names it (`light kind 'disk'`); `implementedIn` is its
 *  spaces (spacesOf(d.glsl) or its SpaceList). */
export function spaceGate(occupant: string, implementedIn: readonly string[], space: string): string | null {
    if (implementedIn.includes(space)) return null;
    return `${occupant} has no ${space} implementation (implemented in: ${implementedIn.length > 0 ? implementedIn.join(', ') : 'no space'})`;
}

/** A scene feature with no descriptor of its own: the spaces it has been checked in, and
 *  whether the program has it (judged on resolved values). */
export interface SpaceLimitation {
    feature: string;
    spaces: SpaceList;
    present(scene: SceneDescription, strategy: RenderStrategy, features: SceneFeatures): boolean;
}

/** A scale other than exactly 1 (a {param} scale counts: it may move away from 1). */
const scaled = (scene: SceneDescription): boolean => scene.objects.some((o) =>
    (isPrimitiveObject(o) || isMeshObject(o)) && o.transform?.scale !== undefined && o.transform.scale !== 1);

export const SPACE_LIMITATIONS: readonly SpaceLimitation[] = [
    { feature: 'mesh objects', spaces: ['euclidean'], present: (scene) => scene.objects.some(isMeshObject) },
    { feature: 'instanced objects', spaces: ['euclidean'], present: (scene) => scene.objects.some(isInstancedObject) },
    { feature: 'object scale other than 1', spaces: ['euclidean'], present: scaled },
    {
        // The generated march steps along the space's geodesics (resolved: a backend pin counts).
        feature: 'marched objects', spaces: ['euclidean', 'hyperbolic', 'spherical'],
        present: (scene) => marchedObjectCount(scene) > 0,
    },
    {
        // uv charts and GLSL expressions (which may read p or uv) are Euclidean constructions.
        feature: 'materials that read uv or hold GLSL expressions', spaces: ['euclidean'],
        present: (scene) => scene.objects.some((o) => (isPrimitiveObject(o) || isMeshObject(o)) && materialReadsUv(o.material, scene)),
    },
    {
        feature: 'media on the null-collision (tracking) arms', spaces: ['euclidean'],
        present: (scene, strategy) => sceneRoutesToTracking(scene, strategy.measurement.scattering ?? 'full'),
    },
    {
        feature: 'deflecting (GRIN) media', spaces: ['euclidean'],
        present: (scene) => Object.values(scene.materials).some((m) => m.medium !== undefined && mediumIsDeflecting(m.medium)),
    },
    { feature: 'an ambient medium', spaces: ['euclidean'], present: (scene) => scene.ambientMedium !== undefined },
    {
        // The default is 'vertex', so an equiangular program is always an authored request.
        feature: "mediumLightSampling 'equiangular'", spaces: ['euclidean'],
        present: (_scene, strategy) => strategy.estimator.mediumLightSampling === 'equiangular',
    },
    {
        // Looked up by BSDF rays at the ray's sky key (H³: its ideal endpoint).
        feature: 'an environment', spaces: ['euclidean', 'hyperbolic'],
        present: (scene) => scene.environment !== undefined && scene.environment.type !== 'none',
    },
    {
        // The Analyzer's resolved fact: image and procedural skies default to sampleAsLight.
        feature: 'an environment sampled as a light', spaces: ['euclidean'],
        present: (_scene, _strategy, features) => features.environment.samplable,
    },
    {
        // Under pure path tracing nothing samples them: BSDF hits find them, so they render.
        // Under NEE, sampleAsLight: false leaves an object to BSDF hits (MIS weight 1).
        feature: 'emissive objects sampled as lights', spaces: ['euclidean'],
        present: (scene, strategy) => sampledEmitterObjects(scene, strategy).length > 0,
    },
];

/** Every reason this program cannot run in its space (features.ambientSpace): the limitation
 *  rows present in it, and the estimator occupants it resolves to (defaults applied, including
 *  the Planner's size-based table dispatch) that have no implementation there. Unregistered
 *  estimator keys are left to their registry gates. */
export function curvedLimitations(scene: SceneDescription, strategy: RenderStrategy, features: SceneFeatures): string[] {
    const space = features.ambientSpace;
    const reasons: string[] = [];
    for (const row of SPACE_LIMITATIONS) {
        if (!row.spaces.includes(space) && row.present(scene, strategy, features))
            reasons.push(`${row.feature}: not implemented in ${space} space (implemented in: ${row.spaces.join(', ')})`);
    }
    const estimator = (axis: string, key: string, d: { spaces: SpaceList } | undefined) => {
        const reason = d === undefined ? null : spaceGate(`estimator.${axis} '${key}'`, d.spaces, space);
        if (reason !== null) reasons.push(reason);
    };
    if (strategy.estimator.directLighting !== 'none') {
        const selection = strategy.estimator.lightSelection ?? DEFAULT_LIGHT_SELECTION;
        estimator('lightSelection', selection, LIGHT_SELECTIONS[selection]);
    }
    const dispatch = objectDispatchOf(scene, strategy);
    estimator('objectDispatch', dispatch, OBJECT_DISPATCHES[dispatch]);
    if (scene.objects.some(isMeshObject)) {
        const traversal = strategy.estimator.meshTraversal ?? DEFAULT_MESH_TRAVERSAL;
        estimator('meshTraversal', traversal, MESH_TRAVERSALS[traversal]);
    }
    if (scene.objects.some(isInstancedObject)) {
        const accel = strategy.estimator.instanceAccel ?? DEFAULT_INSTANCE_ACCEL;
        estimator('instanceAccel', accel, INSTANCE_ACCELS[accel]);
    }
    return reasons;
}
