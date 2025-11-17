import { defineConfig } from 'vite'
import { resolve } from 'path'
import glsl from 'vite-plugin-glsl'

export default defineConfig({
    plugins: [glsl()],
    server: {
        port: 3000,
    },
    test: {
        globals: true,
        environment: 'node',
    },
    build: {
        minify: false,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                'simple-scene': resolve(__dirname, 'examples/simple-scene/index.html'),
                'interactive-materials': resolve(__dirname, 'examples/interactive-materials/index.html'),
                'procedural-materials': resolve(__dirname, 'examples/procedural-materials/index.html'),
                'scene-with-light': resolve(__dirname, 'examples/scene-with-light/index.html'),
            }
        }
    },
    assetsInclude: ['**/*.hdr'],
})
