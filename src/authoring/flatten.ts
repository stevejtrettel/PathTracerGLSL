// authoring/flatten.ts — the authoring layer's seed (docs/fable-transforms.md §4).
//
// The AUTHORING layer is the top of the stack (Authoring → App → Engine → Compiler →
// Components): trees, groups, names, and (later) the live-manipulation graph live
// HERE and only here. SceneDescription stays FLAT forever (owner-decided July 16
// 2026, doc §3) — GroupNode does not exist in the compiler's vocabulary, so a tree
// physically cannot reach it. This file is the build-time half: one pure function
// that composes constant transform chains into per-leaf `Transform`s. The future
// runtime half (the `updateMatrixWorld` equivalent for driven groups) shares this
// algebra but pushes TRS parameter values through the ParameterStore instead of
// emitting a static description.
//
// Until the authoring DSL exists, the interim syntax is TypeScript object literals —
// fixtures and demos call flattenGroups() at definition time.

import type { ObjectDescription, Transform, Quaternion, Vec3 } from '../compiler/types.js';
import { isInstancedObject } from '../compiler/types.js';
import {
    IDENTITY_QUAT,
    IDENTITY_SIMILARITY,
    classifySimilarity,
    isDrivenTransform,
    isIdentityRotation,
    isIdentityScale,
    isIdentityTranslation,
    quatMultiply,
    quatNormalize,
    similarityApplyPoint,
    similarityCompose,
    similarityFromTransform,
    type Similarity,
} from '../components/geometry/similarity.js';
import type { PackedPlacements } from '../compiler/types.js';

export interface GroupNode {
    kind: 'group';
    /** Provenance segment for descendant leaves' `name` paths. Never identity. */
    name?: string;
    transform?: Transform;
    children: SceneNode[];
}

/** Leaves are ORDINARY compiler objects — the tree is authoring structure wrapped
 *  around them; nothing tree-shaped survives flattening. */
export type SceneNode = ObjectDescription | GroupNode;

/**
 * Compose each leaf's root→leaf transform chain into ONE `Transform` (always
 * expressible as TRS — similarities are closed), stamp `name` with the node path,
 * and emit leaves in document order (region ids are assigned in scene order, so
 * authoring order = region order — the stability pin).
 *
 * Static-composition rule (doc §4): only CONSTANT transforms compose here. A
 * `{param}`-driven field under a non-identity ancestor is a build-time error —
 * re-composing per parameter change is exactly the future runtime graph's job.
 * Driven fields under all-identity ancestors pass through unchanged.
 *
 * Depth-0 leaves with no composition and no path to stamp are returned BY REFERENCE
 * (flattening an already-flat scene is the identity).
 */
export function flattenGroups(nodes: SceneNode[]): ObjectDescription[] {
    const out: ObjectDescription[] = [];
    walk(nodes, IDENTITY_SIMILARITY, [], out);
    return out;
}

function walk(nodes: SceneNode[], parent: Similarity, path: string[], out: ObjectDescription[]): void {
    nodes.forEach((node, i) => {
        if ('kind' in node && node.kind === 'group') {
            const label = [...path, node.name ?? `#${i}`];
            if (isDrivenTransform(node.transform)) {
                throw new Error(
                    `flattenGroups: group '${label.join('/')}' has a {param}-driven transform field — `
                    + `static flattening composes constants only (fable-transforms §4); driving a GROUP `
                    + `is the runtime graph's job (unbuilt)`);
            }
            walk(node.children, similarityCompose(parent, similarityFromTransform(node.transform)), label, out);
            return;
        }

        // Instanced batch leaf (impl-plan-instancing): it owns no top-level transform — its
        // placements carry world placement. Under a transformed group, compose the parent
        // similarity into EACH placement (constants only, like every other static-flatten path).
        if (isInstancedObject(node)) {
            const atRootI = path.length === 0;
            const idParent = classifySimilarity(parent) === 'identity';
            const placements = idParent
                ? node.placements
                : Array.isArray(node.placements)
                    ? node.placements.map((t) => transformFromSimilarity(similarityCompose(parent, similarityFromTransform(t))) ?? {})
                    : composePackedPlacements(parent, node.placements);
            if (atRootI && idParent) { out.push(node); return; }
            out.push({ ...node, placements, name: [...path, node.name ?? `#${i}`].join('/') });
            return;
        }

        // Leaf.
        const atRoot = path.length === 0;
        if (isDrivenTransform(node.transform)) {
            // Doc §4: driven leaf fields survive ONLY under all-identity ancestors
            // (there is nothing to compose them with).
            if (classifySimilarity(parent) !== 'identity') {
                throw new Error(
                    `flattenGroups: leaf '${[...path, node.name ?? `#${i}`].join('/')}' has {param}-driven `
                    + `transform fields under a transformed group — static flattening cannot compose `
                    + `C·TRS(param) (fable-transforms §4); place it outside the transformed group or `
                    + `wait for the runtime graph`);
            }
            out.push(atRoot ? node : { ...node, name: node.name ?? [...path, `#${i}`].join('/') });
            return;
        }

        if (atRoot) {
            out.push(node);   // identity pass-through, by reference
            return;
        }

        const composed = similarityCompose(parent, similarityFromTransform(node.transform));
        out.push({
            ...node,
            transform: transformFromSimilarity(composed),
            // A leaf's name is a PATH SEGMENT like a group's (D5): two `ball` leaves in
            // different groups flatten to distinct provenance paths — the old
            // name-replaces-path rule collided them, caught only by the compiler's
            // symbol-clobber guard with a worse message.
            name: [...path, node.name ?? `#${i}`].join('/'),
        });
    });
}

/** Canonical TRS re-expression of a composed similarity, identity components omitted
 *  (an identity placement is `undefined`, matching hand-authored flat scenes). */
export function transformFromSimilarity(g: Similarity): Transform | undefined {
    if (classifySimilarity(g) === 'identity') return undefined;
    const t: Transform = {};
    if (!isIdentityTranslation(g.translation)) t.position = g.translation as Vec3;
    if (!isIdentityRotation(g.rotation)) t.rotation = g.rotation as Quaternion;
    if (!isIdentityScale(g.scale)) t.scale = g.scale;
    return t;
}

/** Compose a constant parent similarity over PACKED placements array-wise
 *  (fable-instance-clouds §4 under fable-transforms §4 static composition): position
 *  through the parent map, size × parent scale, quaternion left-multiplied. Fresh
 *  arrays — the source table (often views over a fetched `.inst` buffer) stays intact. */
function composePackedPlacements(parent: Similarity, p: PackedPlacements): PackedPlacements {
    const n = p.count;
    const positions = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
        const w = similarityApplyPoint(parent, [p.positions[3 * i], p.positions[3 * i + 1], p.positions[3 * i + 2]]);
        positions[3 * i] = w[0]; positions[3 * i + 1] = w[1]; positions[3 * i + 2] = w[2];
    }
    let sizes: Float32Array | undefined;
    if (parent.scale !== 1 || p.sizes !== undefined) {
        sizes = new Float32Array(n);
        for (let i = 0; i < n; i++) sizes[i] = parent.scale * (p.sizes !== undefined ? p.sizes[i] : 1);
    }
    let orientations: Float32Array | undefined;
    if (!isIdentityRotation(parent.rotation)) {
        orientations = new Float32Array(4 * n);
        for (let i = 0; i < n; i++) {
            const q = p.orientations !== undefined
                ? [p.orientations[4 * i], p.orientations[4 * i + 1], p.orientations[4 * i + 2], p.orientations[4 * i + 3]] as const
                : IDENTITY_QUAT;
            const c = quatNormalize(quatMultiply(parent.rotation, [q[0], q[1], q[2], q[3]]));
            orientations[4 * i] = c[0]; orientations[4 * i + 1] = c[1]; orientations[4 * i + 2] = c[2]; orientations[4 * i + 3] = c[3];
        }
    } else {
        orientations = p.orientations;
    }
    return {
        count: n, positions,
        ...(sizes !== undefined ? { sizes } : {}),
        ...(orientations !== undefined ? { orientations } : {}),
    };
}

// Driven detection (`isDrivenTransform`) is shared from components/geometry/similarity —
// one implementation for the Planner, the Validator, and this flatten.
