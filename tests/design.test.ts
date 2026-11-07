import { it } from 'vitest';
import { place, firstHit, cameraRay, exp, blocked, type Placed } from './witnesses/scenes/h2xrTwins.js';
const size: [number, number] = [160, 120];
function windows(objs: Placed[], pose: any, fov: number, lights: any[], tags: string[]) {
  const grid: string[][] = [];
  for (let py = 0; py < 120; py++) { const row: string[] = [];
    for (let px = 0; px < 160; px++) { let ok = '';
      for (const [sx, sy] of [[0.02,0.02],[0.98,0.02],[0.02,0.98],[0.98,0.98],[0.5,0.5]]) {
        const r = cameraRay(pose, fov, size, px + sx, py + sy); const h = firstHit(objs, r.p, r.v);
        let c = h ? (h.obj.tag === 'C' && Math.abs(h.n[1]) > 0.5 ? 'T' : h.obj.tag) : '.';
        if (h && lights.some((q: any) => blocked(objs, h.x, q))) c = 's';
        ok = ok === '' || ok === c ? c : '?'; }
      row.push(ok); }
    grid.push(row); }
  const inside = (t: string, x0: number, y0: number, x1: number, y1: number) => { for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) if (grid[y]?.[x] !== t) return false; return true; };
  for (const t of tags) { let best: number[] | null = null, area = 0;
    for (let y0 = 1; y0 < 119; y0++) for (let x0 = 1; x0 < 159; x0++) { if (grid[y0][x0] !== t) continue;
      for (let y1 = y0; y1 < 119 && inside(t, x0, y0, x0, y1); y1++) { let x1 = x0; while (x1 + 1 < 159 && inside(t, x0, y0, x1 + 1, y1)) x1++;
        const a = (x1 - x0 + 1) * (y1 - y0 + 1) * Math.min(1, (x1 - x0 + 1) / (y1 - y0 + 1), (y1 - y0 + 1) / (x1 - x0 + 1)) ** 0.5; if (a > area) { area = a; best = [x0, y0, x1, y1]; } } }
    console.log(t, best ? JSON.stringify({ x: best[0] / 160, y: best[1] / 120, w: (best[2] - best[0] + 1) / 160, h: (best[3] - best[1] + 1) / 120, px: (best[2]-best[0]+1)*(best[3]-best[1]+1) }) : 'none'); }
  const rows: string[] = []; for (let py = 118; py >= 0; py -= 4) rows.push(grid[py].filter((_, i) => i % 3 === 1).join('')); console.log(rows.join('\n'));
}
it('point-light scene', () => {
  const objs = [
    place('D', { kind: 'disk', radius: 0.5, normal: [0, 1, 0] }),
    place('W', { kind: 'plane', normal: [0, 0, 1], offset: 0.75 }),
    place('B', { kind: 'sphere', radius: 0.3 }, [0.12, 0.1, 0], [0.42, 0.15, -0.3], 0.9),
    place('C', { kind: 'cylinder', radius: 0.25, halfHeight: 0.25 }, [0, 0, 0], [-0.5, 0.0, -0.3]),
  ];
  windows(objs, { position: [0, 0.95, 0.9], target: [0, 0.05, -0.3] }, 1.3, [exp([0.6, 1.0, 0.45]), exp([-0.35, 0.9, 0.55])], ['D', 'W', 'B', 'C', 'T']);
});
