import type { GeometryRuntime, GeoFrame, Vec3 } from "../../core/types";

/** Euclidean frame matches the shader's Frame { p,f,u,r } */
export interface EucFrame extends GeoFrame {
    p: Vec3; // position
    f: Vec3; // forward
    u: Vec3; // up
    r: Vec3; // right
}

/* -------------------- tiny vec helpers (no libs) -------------------- */
function v(x=0, y=0, z=0): Vec3 { return { x, y, z }; }

function addScaled(a: Vec3, b: Vec3, s: number): void {
    a.x += b.x * s; a.y += b.y * s; a.z += b.z * s;
}
function dot(a: Vec3, b: Vec3): number { return a.x*b.x + a.y*b.y + a.z*b.z; }
function cross(out: Vec3, a: Vec3, b: Vec3): void {
    const x = a.y*b.z - a.z*b.y;
    const y = a.z*b.x - a.x*b.z;
    const z = a.x*b.y - a.y*b.x;
    out.x = x; out.y = y; out.z = z;
}
function length(a: Vec3): number { return Math.hypot(a.x, a.y, a.z); }
function normalize(a: Vec3): void {
    const L = length(a);
    if (L > 0) { a.x /= L; a.y /= L; a.z /= L; }
}
/** Rodrigues' rotation: rotate v around unit axis k by angle t (in place). */
function rotateAroundAxis(vv: Vec3, k: Vec3, t: number): void {
    // ensure k is unit
    const L = length(k) || 1;
    const ux = k.x / L, uy = k.y / L, uz = k.z / L;
    const cos = Math.cos(t), sin = Math.sin(t);
    const vx = vv.x, vy = vv.y, vz = vv.z;

    // v*cosθ + (k×v)*sinθ + k*(k·v)*(1−cosθ)
    const kdotv = ux*vx + uy*vy + uz*vz;
    const kxv_x = uy*vz - uz*vy;
    const kxv_y = uz*vx - ux*vz;
    const kxv_z = ux*vy - uy*vx;

    vv.x = vx*cos + kxv_x*sin + ux * kdotv * (1 - cos);
    vv.y = vy*cos + kxv_y*sin + uy * kdotv * (1 - cos);
    vv.z = vz*cos + kxv_z*sin + uz * kdotv * (1 - cos);
}

/* Rotate the frame about one of its *current* local axes by angle t. */
function rotateFrameAbout(frame: EucFrame, axis: "f"|"u"|"r", t: number): void {
    // copy the axis at call time (intrinsic rotation)
    const k = v(frame[axis].x, frame[axis].y, frame[axis].z);
    rotateAroundAxis(frame.f, k, t);
    rotateAroundAxis(frame.u, k, t);
    rotateAroundAxis(frame.r, k, t);
}

/* Re-orthonormalize the frame with a light Gram–Schmidt. */
function stabilizeFrame(frame: EucFrame): void {
    normalize(frame.f);
    // u ⟂ f
    const uDotF = dot(frame.u, frame.f);
    addScaled(frame.u, frame.f, -uDotF);
    normalize(frame.u);
    // r = f × u (right-handed)
    const rtmp = v();
    cross(rtmp, frame.f, frame.u);
    frame.r.x = rtmp.x; frame.r.y = rtmp.y; frame.r.z = rtmp.z;
    normalize(frame.r);
    // tighten u against r too
    const uDotR = dot(frame.u, frame.r);
    addScaled(frame.u, frame.r, -uDotR);
    normalize(frame.u);
}

/* -------------------- runtime implementation -------------------- */
export default class EuclideanRuntime implements GeometryRuntime<EucFrame> {
    createDefaultFrame(): EucFrame {
        return {
            p: v(0, 1.5, 5),     // sit at +Z looking toward origin
            f: v(0, 0, -1),
            u: v(0, 1, 0),
            r: v(1, 0, 0),
        };
    }

    moveLocal(frame: EucFrame, local: Vec3, speed: number, dt: number): void {
        const s = speed * dt;
        addScaled(frame.p, frame.r, local.x * s);
        addScaled(frame.p, frame.u, local.y * s);
        addScaled(frame.p, frame.f, local.z * s);
    }

    rotateLocal(frame: EucFrame, angular: Vec3, rotSpeed: number, dt: number): void {
        const ax = angular.x * rotSpeed * dt; // pitch (about right)
        const ay = angular.y * rotSpeed * dt; // yaw   (about up)
        const az = angular.z * rotSpeed * dt; // roll  (about forward)
        // Intrinsic yaw → pitch → roll (common camera convention)
        if (ay) rotateFrameAbout(frame, "u", ay);
        if (ax) rotateFrameAbout(frame, "r", ax);
        if (az) rotateFrameAbout(frame, "f", az);
        stabilizeFrame(frame);
    }

    stabilize(frame: EucFrame): void {
        stabilizeFrame(frame);
    }
}
