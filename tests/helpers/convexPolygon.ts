// Exact areas of convex polygons and their intersections (Sutherland–Hodgman clipping and the
// shoelace formula). Used by the bladed-aperture twin test and the bokeh-edge witness, which
// both need the exact area of part of a regular n-gon.

export type Point2 = [number, number];

/** Vertices of the regular n-gon of circumradius `radius`, counterclockwise, the first at
 *  angle `rotation` from +x. */
export function regularPolygon(n: number, rotation: number, radius = 1): Point2[] {
    return Array.from({ length: n }, (_, k) => {
        const angle = rotation + (2 * Math.PI * k) / n;
        return [radius * Math.cos(angle), radius * Math.sin(angle)];
    });
}

/** The part of `poly` where a·x + b·y ≥ c. */
export function clipHalfPlane(poly: Point2[], a: number, b: number, c: number): Point2[] {
    const out: Point2[] = [];
    const side = (p: Point2) => a * p[0] + b * p[1] - c;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const sp = side(p), sq = side(q);
        if (sp >= 0) out.push(p);
        if ((sp >= 0) !== (sq >= 0)) {
            const t = sp / (sp - sq);
            out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
        }
    }
    return out;
}

/** The part of `poly` inside the convex counterclockwise polygon `clip`. */
export function clipConvex(poly: Point2[], clip: Point2[]): Point2[] {
    let out = poly;
    for (let i = 0; i < clip.length && out.length > 0; i++) {
        const p = clip[i], q = clip[(i + 1) % clip.length];
        // Left of the directed edge p→q: (q − p) × (x − p) ≥ 0.
        const a = -(q[1] - p[1]), b = q[0] - p[0];
        out = clipHalfPlane(out, a, b, a * p[0] + b * p[1]);
    }
    return out;
}

export function polygonArea(poly: Point2[]): number {
    let twice = 0;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        twice += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(twice) / 2;
}
