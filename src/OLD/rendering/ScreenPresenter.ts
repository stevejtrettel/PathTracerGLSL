import ShaderProgram from "./ShaderProgram";
import FullscreenQuad from "./FullscreenQuad";
import type { Plugin, GLSLChunk } from "../core/types";
import { ChunkNames } from "../core/types";

export default class ScreenPresenter {
    private gl: WebGL2RenderingContext;
    private quad: FullscreenQuad;
    private program: ShaderProgram;

    constructor(gl: WebGL2RenderingContext, vertexSrc: string, postprocess: Plugin) {
        this.gl = gl;
        this.quad = new FullscreenQuad(gl);
        this.program = this.buildProgram(vertexSrc, postprocess);
    }

    updatePostprocess(vertexSrc: string, postprocess: Plugin) {
        this.program.delete?.();
        this.program = this.buildProgram(vertexSrc, postprocess);
    }

    /** Present from a bound texture unit (e.g., 0). */
    blitFromTexUnit(texUnit: number) {
        const { gl } = this;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); // default framebuffer (screen)
        this.program.use();
        this.program.set1i("u_src", texUnit);
        this.quad.draw();
    }

    private buildProgram(vertexSrc: string, postprocess: Plugin): ShaderProgram {
        const chunk = this.findPostprocessChunk(postprocess);
        const fragSrc = this.composeFragment(chunk);
        return new ShaderProgram(this.gl, vertexSrc, fragSrc);
    }

    private findPostprocessChunk(postprocess: Plugin): GLSLChunk {
        const chunks = postprocess.chunks?.() ?? [];
        const chunk = chunks.find(c => c.name === ChunkNames.PostprocessApply && c.stage === "frag");
        if (!chunk) throw new Error("[ScreenPresenter] Active postprocess plugin lacks postprocess.apply");
        return chunk;
    }

    private composeFragment(postprocessChunk: GLSLChunk): string {
        return `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_src;

// --- active postprocess plugin ---
${postprocessChunk.source}

void main(){
  vec3 hdr = texture(u_src, v_uv).rgb;
  vec3 ldr = postprocess(hdr);
  outColor = vec4(ldr, 1.0);
}`;
    }
}
