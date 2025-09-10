import ShaderProgram from "../rendering/ShaderProgram";
import Uniforms from "./Uniforms";

/**
 * Shared types for our test plugins (sandbox).
 * Plugins provide full fragment GLSL and set their own uniforms via `Uniforms`.
 */
export interface ColorPlugin {
    getFragmentSource(): string;
    applyUniforms(u: Uniforms): void;
}
