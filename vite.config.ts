import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'

export default defineConfig({
    plugins: [glsl()],
    server: {
        port: 3000, // or whatever you prefer
    },
    test: {
        globals: true,
        environment: 'node', // or 'jsdom' if you want DOM APIs
    },
})
