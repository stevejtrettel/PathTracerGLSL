import type { ColorPlugin } from "../types";
import UniformManager from "../../systems/UniformManager";
import gradientFrag from "./gradient-color.shader.frag";

export default class GradientColorPlugin implements ColorPlugin {
    private prefix: string;
    private tint: [number, number, number];
    private speed: number; // 0 = static
    private startMs = performance.now();

    constructor(opts?: {
        prefix?: string;
        tint?: [number, number, number];
        speed?: number;
    }) {
        this.prefix = opts?.prefix ?? "";
        this.tint   = opts?.tint   ?? [1, 1, 1];
        this.speed  = opts?.speed  ?? 0.0;
    }

    private applyPrefix(src: string): string {
        if (!this.prefix) return src;
        return src
            .replaceAll(/\bu_tint\b/g, `${this.prefix}u_tint`)
            .replaceAll(/\bu_time\b/g, `${this.prefix}u_time`);
    }

    getFragmentSource(): string {
        return this.applyPrefix(gradientFrag);
    }

    applyUniforms(u: UniformManager): void {
        const [tr, tg, tb] = this.tint;
        u.set3f("u_tint", tr, tg, tb);

        const elapsedSec = (performance.now() - this.startMs) * 0.001;
        const t = this.speed !== 0 ? elapsedSec * this.speed : 0.0;
        u.set1f("u_time", t);
    }

    setTint(t: [number, number, number]) { this.tint = t; }
    getTint(): [number, number, number]  { return this.tint; }
    setSpeed(omega: number) { this.speed = omega; }
    getSpeed(): number      { return this.speed; }
}
