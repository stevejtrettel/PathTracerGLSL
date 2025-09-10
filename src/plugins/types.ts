
import UniformManager from "../systems/UniformManager";

/**
 * Shared types for our test plugins (sandbox).
 * Plugins provide full fragment GLSL and set their own uniforms via `Uniforms`.
 */
export interface ColorPlugin {
    getFragmentSource(): string;
    applyUniforms(u: UniformManager): void;
}
