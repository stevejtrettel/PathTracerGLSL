// Prototype of "one generated support table": walks every component registry and prints,
// per occupant, which spaces it has a body for. Today every glsl is a plain string, which
// under design 1 means "euclidean only". Also scans each body for raw Euclidean operations
// (a HEURISTIC hint of which occupants could be declared space-agnostic; not a verdict).
const R = '/Users/stevetrettel/Code/PathTracerGLSL/src/components/';
const fams: Array<[string, string, string]> = [
  ['geometry', 'geometry/index.ts', 'PRIMITIVES'],
  ['lights', 'lights/index.ts', 'LIGHT_KINDS'],
  ['light selection', 'lights/index.ts', 'LIGHT_SELECTIONS'],
  ['materials', 'materials/index.ts', 'MATERIAL_MODELS'],
  ['volume_scattering', 'volume_scattering/index.ts', 'VOLUME_SCATTERING_MODELS'],
  ['camera', 'camera/index.ts', 'CAMERA_MODELS'],
  ['env chart', 'env/index.ts', 'ENV_CHARTS'],
  ['ambient', 'ambient/index.ts', 'AMBIENT_SPACES'],
  ['accumulator', 'accumulator/index.ts', 'ACCUMULATORS'],
  ['tonemap', 'tonemap/index.ts', 'TONEMAP_MODELS'],
  ['pixel', 'pixel/index.ts', 'PIXEL_MODELS'],
  ['sampler', 'sampler/index.ts', 'SAMPLERS'],
  ['sensor', 'sensor/index.ts', 'SENSORS'],
  ['aov', 'aov/index.ts', 'AOVS'],
  ['color', 'color/index.ts', 'COLOR_MODELS'],
  ['mesh traversal', 'intersection/index.ts', 'MESH_TRAVERSALS'],
  ['instance accel', 'intersection/index.ts', 'INSTANCE_ACCELS'],
  ['object dispatch', 'intersection/index.ts', 'OBJECT_DISPATCHES'],
];
// Raw operations that assume a flat vec3 model (heuristic).
const raw = [/\bdot\s*\(/, /\blength\s*\(/, /\bdistance\s*\(/, /\bcross\s*\(/, /\breflect\s*\(/, /\brefract\s*\(/, /\bvec3\s+\w+\s*=\s*\w+\s*[+-]\s*\w+\s*\*\s*/];
let total = 0;
const rows: string[] = [];
for (const [fam, file, name] of fams) {
  const mod = await import(R + file);
  const reg = mod[name] as Record<string, any>;
  if (!reg) { rows.push(`| ${fam} | (registry ${name} not found) | | |`); continue; }
  for (const [key, d] of Object.entries(reg)) {
    total++;
    const g = typeof d?.glsl === 'string' ? d.glsl : undefined;
    const hits = g ? raw.filter(r => r.test(g.replace(/\/\/.*$/gm, ''))).length : -1;
    const ambient = g ? (g.match(/ambient_\w+/g) ?? []).length : 0;
    rows.push(`| ${fam} | ${key} | ${g === undefined ? 'no glsl field' : 'euclidean'} | ${g === undefined ? '-' : `${hits} raw-op kinds, ${ambient} ambient_* calls`} |`);
  }
}
console.log('| family | occupant | spaces (design 1 reading today) | heuristic scan |\n|---|---|---|---|');
console.log(rows.join('\n'));
console.log(`\n${total} occupants in ${fams.length} registries`);
