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
            }
        }
    },
    assetsInclude: ['**/*.hdr'],
})
