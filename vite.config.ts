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
                'cornell-box': resolve(__dirname, 'examples/cornell-box/index.html'),
                'cornell-menger': resolve(__dirname, 'examples/cornell-menger/index.html'),
                'multi-light-test': resolve(__dirname, 'examples/multi-light-test/index.html'),
                'rgb-lights': resolve(__dirname, 'examples/rgb-lights/index.html'),
                'rgb-lights-interactive': resolve(__dirname, 'examples/rgb-lights-interactive/index.html'),
            }
        }
    },
    assetsInclude: ['**/*.hdr'],
})
