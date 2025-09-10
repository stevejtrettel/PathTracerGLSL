import type { ColorPlugin } from "../types";
import UniformManager from "../../systems/UniformManager";
import solidFrag from "./solid-color-shader.frag";

export default class SolidColorPlugin implements ColorPlugin {
    private color: [number, number, number];
    private speed: number;
    private startMs = performance.now();
    private prefix: string;

    constructor(
        color: [number, number, number] = [1, 0, 0],
        speed = 1.0,
        prefix = "" // e.g., "u_solid_"
    ) {
        this.color = color;
        this.speed = speed;
        this.prefix = prefix;
    }

    private applyPrefix(src: string): string {
        if (!this.prefix) return src;
        // Explicit replacements keep this transparent and safe.
        return src
            .replaceAll(/\bu_color\b/g, `${this.prefix}u_color`)
            .replaceAll(/\bu_time\b/g,  `${this.prefix}u_time`);
    }

    getFragmentSource(): string {
        return this.applyPrefix(solidFrag);
    }

    applyUniforms(u: UniformManager): void {
        const [r, g, b] = this.color;
        u.set3f("u_color", r, g, b);
        const elapsedSec = (performance.now() - this.startMs) * 0.001;
        u.set1f("u_time", elapsedSec * this.speed);
    }

    setColor(c: [number, number, number]) { this.color = c; }
    getColor(): [number, number, number] { return this.color; }
    setSpeed(omega: number) { this.speed = omega; }
    getSpeed(): number { return this.speed; }
}
