// pages/sections.ts — the gallery's display taxonomy: every scene in the merged
// registry (pages/registry.ts) filed into one purpose-shaped section. This is a VIEW
// concern only — the witness registry stays display-free; nothing here affects the
// lab, the witness runner, or any test.
//
// An entry is either a plain id (one gallery row) or { id, partners } — partners are
// fixture ref arms (a twin's other half) folded into the primary's row instead of
// getting their own card. They stay fully renderable via lab.html?scene=<id>; the
// gallery just stops spending a card on them.
//
// The guard at the bottom fails loudly (same stance as registry.ts's collision
// check): every registry id must appear exactly once, and no section may reference
// an id that doesn't exist — a new scene breaks the gallery until it is filed here.

import { sceneSuite } from './registry.js';

export interface SectionEntry {
    id: string;
    /** Fixture ref arms folded into this row (rendered as links, not rows). */
    partners?: string[];
}

export interface GallerySection {
    title: string;
    /** One-line section subtitle. */
    blurb: string;
    entries: SectionEntry[];
}

const e = (id: string, ...partners: string[]): SectionEntry =>
    partners.length ? { id, partners } : { id };

export const gallerySections: GallerySection[] = [
    {
        title: 'Instance clouds',
        blurb: 'external .inst datasets — hundreds of thousands of instanced spheres per scene (untracked data files, async load)',
        entries: [e('clebsch'), e('clebsch-glow'), e('croissant'), e('steiner'), e('crixxi'), e('octic'), e('c32')],
    },
    {
        title: 'GRIN & curved light',
        blurb: 'variable-IOR media: the Verlet geodesic walker, hard interfaces, emission & scattering on bent paths, black holes',
        entries: [
            e('grin'), e('maxwell'), e('blackhole'), e('accretion'), e('glassball'),
            e('grin-vacuum', 'grin-vacuum-ref'),
            e('grin-glass', 'grin-glass-ref'),
            e('grin-emit', 'grin-emit-ref'),
            e('grin-scatter', 'grin-scatter-ref'),
            e('grin-furnace'), e('grin-furnace-hard'), e('grin-furnace-emit'), e('grin-furnace-scatter'), e('grin-long'),
        ],
    },
    {
        title: 'Meshes',
        blurb: 'triangle meshes: BVH traversal, emissive mesh lights, closed-mesh containment (glass, fog, nesting)',
        entries: [
            e('meshes'), e('models'), e('cacti'),
            e('mesh-furnace'),
            e('mesh-quad-twin', 'mesh-quad-ref'),
            e('mesh-light-twin', 'mesh-light-ref'), e('mesh-light-smooth'), e('mesh-slab-albedo'), e('mesh-scale-twin', 'mesh-scale-twin-ref'),
            e('mesh-glass-box', 'mesh-glass-box-ref'),
            e('mesh-fog', 'mesh-fog-ref'),
            e('mesh-submerged', 'mesh-submerged-ref'),
        ],
    },
    {
        title: 'Instancing & scene scale',
        blurb: 'one prototype × N placements, per-instance attributes, the TLAS, instanced interiors (glass and media), and the scene object table',
        entries: [
            e('instance-glass', 'instance-glass-ref'),
            e('instance-glass-mesh', 'instance-glass-mesh-ref'),
            e('instance-fog', 'instance-fog-ref'),
            e('spheres'), e('forest'), e('grand-bazaar'), e('bazaar'), e('sdf-field'), e('sdf-knot'),
            e('instance-twin', 'instance-twin-ref'),
            e('cube-cloud', 'cube-cloud-ref'),
            e('instance-params-twin', 'instance-params-frame'),
            e('perf-cloud', 'perf-cloud-frame'),
            e('perf-instance-glass', 'perf-instance-opaque'),
            e('mesh-instance-twin', 'mesh-instance-ref'),
            e('attr-twin', 'attr-twin-ref'),
        ],
    },
    {
        title: 'Heterogeneous media & emission',
        blurb: 'delta/ratio tracking over formula density fields, the majorant ceiling, and volume emission ε',
        entries: [
            e('groundfog'), e('glowblobs'),
            e('het-const', 'het-const-ref'),
            e('het-slab'),
            e('clamp', 'clamp-ref'),
            e('het-driven', 'het-driven-baked'),
            e('het-driven-theta2', 'het-driven-baked2'),
            e('emit'), e('emit-swap'), e('emit-sat'), e('emit-driven'), e('emit-scatter'),
        ],
    },
    {
        title: 'Homogeneous media',
        blurb: 'constant media: Beer–Lambert, chromatic scattering, medium NEE + equiangular placement, shadow media, and random-walk subsurface scattering (a refractive boundary around a scattering interior — no subsurface model)',
        entries: [
            e('slab'), e('furnace-scatter'), e('sss-furnace'), e('slab-albedo', 'slab-albedo-ref'), e('slab-albedo-sparse'), e('slab-albedo-aniso'), e('haze'), e('shadow-medium'), e('null-budget-view'), e('null-budget'), e('fog-panel'),
            e('fogcube'), e('fogblobs'), e('rayleigh'), e('marble'), e('sss-lab'), e('sss-presets'), e('porcelain'), e('porcelain-array'), e('mist'),
        ],
    },
    {
        title: 'Area lights & MIS',
        blurb: 'samplable emitters — quad, disk, sphere, spot, and the delta-direction pair (sun, beam) — the power CDF, the light tree (many lights), and the pt/pt-nee/pt-mis convergence gates',
        entries: [
            e('two-light'), e('hundred-spheres'), e('instance-lights', 'instance-lights-ref'), e('instance-lights-sky'), e('glow-shell'), e('accel-triple'), e('embers'), e('cornell-area'), e('cornell-area-glass'), e('fog-area'), e('fog-area-ignored'),
            e('orb'), e('cornell-disk'), e('shadow-aim-march'), e('shadow-aim-far'), e('shadow-aim-fog'),
            e('disk-bake', 'disk-bake-ref'),
            e('spot'), e('veach-mis'),
            e('sun'), e('beam-wall'), e('beam-slab'), e('beam-fog'), e('laser'),
            e('softbeam-wall'), e('laser-soft'),
        ],
    },
    {
        title: 'Environment lighting',
        blurb: 'the env as a samplable light: CDF inversion, two-stage selection, the procedural bake, the chart axis',
        entries: [e('sky'), e('furnace-sky'), e('sky-lamp'), e('proc-sky'), e('proc-sky-rotated'), e('fog-sky')],
    },
    {
        title: 'Dielectrics & regions',
        blurb: 'smooth and ROUGH dielectrics (the η² factor either way), nested regions, innermost-wins classification, and the two-sided NEE that rough glass forces',
        entries: [
            e('eta'), e('cornell-glass'), e('analytic-glass'), e('submerged'),
            e('regions-transformed', 'regions-transformed-ref'),
            e('rough-smooth-limit'), e('rough-mis'), e('glass-inclusion'), e('rough-furnace'), e('region-overlap'),
            e('rough-grin', 'rough-grin-ref'),
            e('rough-sheet'),
        ],
    },
    {
        title: 'Materials & texturing',
        blurb: 'surface models and texturing: mirror + GGX showcase, blackbody emission, UV charts, expression albedos',
        entries: [
            e('chrome'), e('mirror'), e('hearth'), e('charts'), e('paint'),
            e('expr-const', 'expr-const-ref'),
        ],
    },
    {
        title: 'The SDF shape library',
        blurb: 'distance fields as ordinary shapes: a constructed bottle, a vendored model, the torus — and scene-local fields defined where they are used',
        entries: [e('sdf-shapes'), e('fractals'), e('custom-fields'), e('field-glass'), e('glass-lab'), e('gyroid-field')],
    },
    {
        title: 'Transforms & driven placement',
        blurb: 'the similarity system: plan-time folds, tree flattening, conjugation, {param}-driven placement and lights',
        entries: [
            e('cylinders'),
            e('transform-bake', 'transform-bake-ref'),
            e('flatten-tree'),
            e('conjugation', 'conjugation-base'),
            e('driven', 'driven-baked-theta'),
            e('driven-theta2', 'driven-baked-theta2'),
            e('light-driven', 'light-driven-baked'),
            e('light-driven-theta2', 'light-driven-baked2'),
            e('light-off', 'light-off-baked'),
        ],
    },
    {
        title: 'Cameras & view',
        blurb: 'the camera family, the fisheye sub-projections, accumulation occupants, and the tonemap roster',
        entries: [e('cornell'), e('cornell-fisheye'), e('cornell-oneshot'), e('thinlens-zero'), e('tonemap')],
    },
    {
        title: 'Core validation',
        blurb: 'the first-principles anchors: the furnace, the minimal cross-backend twins, combined-backend shadows',
        entries: [
            e('furnace'), e('bounce-budget'), e('tiny-sphere'), e('tiny-sphere-light'), e('sun-haze'), e('minimal'), e('analytic-minimal'), e('solids-analytic', 'solids-sdf'),
            e('sdf-table-twin'), e('sdf-instance-twin', 'sdf-instance-twin-ref'),
            // The SDF perf ladders ride as PARTNER links, not cards (the perf-cloud
            // convention): a card compiles every strategy arm at load, and the N=128
            // rows carry a global-marcher arm at 529 ms/frame — grand-bazaar's rule.
            e('perf-sdf-8', 'perf-sdf-0', 'perf-sdf-32', 'perf-sdf-128', 'perf-sdf-cluster-8', 'perf-sdf-cluster-32', 'perf-sdf-cluster-128', 'perf-sdf-blob'),
            e('mixed'),
        ],
    },
];

// ---- completeness guard: exactly-once coverage, no dangling ids ----------------

const filed = new Map<string, string>();
for (const section of gallerySections) {
    for (const entry of section.entries) {
        for (const id of [entry.id, ...(entry.partners ?? [])]) {
            if (!(id in sceneSuite)) {
                throw new Error(`sections: '${id}' (section '${section.title}') is not in the scene registry`);
            }
            const prev = filed.get(id);
            if (prev !== undefined) {
                throw new Error(`sections: '${id}' is filed twice ('${prev}' and '${section.title}')`);
            }
            filed.set(id, section.title);
        }
    }
}
for (const id of Object.keys(sceneSuite)) {
    if (!filed.has(id)) {
        throw new Error(`sections: scene '${id}' is not filed in any gallery section — add it to pages/sections.ts`);
    }
}
