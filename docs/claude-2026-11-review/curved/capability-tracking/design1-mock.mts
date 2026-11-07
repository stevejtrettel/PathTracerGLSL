// Mock of design 1: each space-dependent descriptor keys its GLSL by space. "Supports X" =
// "has a body for X". One helper gives the body, one helper gives the diagnostic, one function
// prints the matrix. Agnostic code is listed under each space it has been checked in (no
// wildcard: a wildcard would claim support for spaces that do not exist yet).
type Bodies = Partial<Record<string, string>>;
interface D { glsl: Bodies }
const SPACES = ['euclidean', 'hyperbolic', 'spherical'];         // = Object.keys(AMBIENT_SPACES)
const lambert = 'lambert src', sphereE = 'sphere E', sphereH = 'sphere H', torusE = 'torus E';
const FAMILIES: Record<string, Record<string, D>> = {
  geometry:  { sphere: { glsl: { euclidean: sphereE, hyperbolic: sphereH } }, torus: { glsl: { euclidean: torusE } } },
  materials: { lambert: { glsl: { euclidean: lambert, hyperbolic: lambert, spherical: lambert } } },
};
const bodyFor = (d: D, space: string) => d.glsl[space];
function spaceGate(family: string, key: string, d: D, space: string): string | null {
  if (bodyFor(d, space) !== undefined) return null;
  const has = Object.keys(d.glsl);
  return `${family} '${key}' has no ${space} implementation (implemented in: ${has.join(', ')})`;
}
function matrix(): string {
  const head = `| family | occupant | ${SPACES.join(' | ')} |\n|---|---|${SPACES.map(() => '---').join('|')}|`;
  const rows = Object.entries(FAMILIES).flatMap(([f, reg]) => Object.entries(reg).map(([k, d]) =>
    `| ${f} | ${k} | ${SPACES.map(s => d.glsl[s] === undefined ? '' : 'yes').join(' | ')} |`));
  return [head, ...rows].join('\n');
}
console.log(matrix());
console.log();
for (const [space, used] of [['spherical', [['geometry', 'sphere'], ['materials', 'lambert']]], ['hyperbolic', [['geometry', 'torus']]]] as const)
  for (const [f, k] of used) console.log(space, '→', spaceGate(f, k, FAMILIES[f][k], space) ?? 'ok');
