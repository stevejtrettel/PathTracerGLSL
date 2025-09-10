// // src/rendering/FullscreenQuad.ts
//
// export class FullscreenQuad {
//     private vao: WebGLVertexArrayObject;
//
//     constructor(private gl: WebGL2RenderingContext) {
//         this.vao = this.createVAO();
//     }
//
//     private createVAO(): WebGLVertexArrayObject {
//         const vao = this.gl.createVertexArray();
//         if (!vao) {
//             throw new Error('Failed to create VAO');
//         }
//
//         // Bind the VAO - even though we have no vertex data,
//         // WebGL requires a VAO to be bound for drawing
//         this.gl.bindVertexArray(vao);
//
//         return vao;
//     }
//
//     render(): void {
//         this.gl.bindVertexArray(this.vao);
//         // Draw the fullscreen triangle (3 vertices generated in vertex shader)
//         this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
//     }
//
//     destroy(): void {
//         this.gl.deleteVertexArray(this.vao);
//     }
// }




// A minimal fullscreen quad helper for WebGL2, using TRIANGLE_STRIP.
// Assumes your vertex shader has:
//   layout(location = 0) in vec2 a_pos;
//   layout(location = 1) in vec2 a_uv;

export default class FullscreenQuad {
    private gl: WebGL2RenderingContext;
    private vao: WebGLVertexArrayObject | null;
    private vboPos: WebGLBuffer | null;
    private vboUV: WebGLBuffer | null;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;

        // Clip-space positions (covers full screen)
        const positions = new Float32Array([
            -1, -1,
            1, -1,
            -1,  1,
            1,  1,
        ]);

        // UVs in [0,1]
        const uvs = new Float32Array([
            0, 0,
            1, 0,
            0, 1,
            1, 1,
        ]);

        const vao = gl.createVertexArray();
        if (!vao) throw new Error("Failed to create VAO");
        this.vao = vao;
        gl.bindVertexArray(vao);

        // Positions -> location 0
        const vboPos = gl.createBuffer();
        if (!vboPos) throw new Error("Failed to create position buffer");
        this.vboPos = vboPos;
        gl.bindBuffer(gl.ARRAY_BUFFER, vboPos);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        // UVs -> location 1
        const vboUV = gl.createBuffer();
        if (!vboUV) throw new Error("Failed to create UV buffer");
        this.vboUV = vboUV;
        gl.bindBuffer(gl.ARRAY_BUFFER, vboUV);
        gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

        // Safety: unbind
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    draw(): void {
        const gl = this.gl;
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    dispose(): void {
        const gl = this.gl;
        if (this.vboPos) gl.deleteBuffer(this.vboPos);
        if (this.vboUV) gl.deleteBuffer(this.vboUV);
        if (this.vao) gl.deleteVertexArray(this.vao);
        this.vboPos = this.vboUV = null;
        this.vao = null;
    }
}
