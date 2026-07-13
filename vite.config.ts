import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'
import { execSync } from 'node:child_process'

// Build-time git stamp for export metadata (reproducibility stamps): every
// exported image records the exact code revision that produced it.
let gitHash = 'unknown'
try {
    gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
    if (execSync('git status --porcelain', { encoding: 'utf8' }).trim()) gitHash += '-dirty'
} catch { /* not a git checkout — stamp stays 'unknown' */ }

export default defineConfig({
    plugins: [glsl()],
    define: {
        __GIT_HASH__: JSON.stringify(gitHash),
    },
    server: {
        port: 3000, // or whatever you prefer
    },
    test: {
        globals: true,
        environment: 'node', // or 'jsdom' if you want DOM APIs
    },
    build: {
        minify: false,     // <- no minify (make true, or remove to go back to min)v
    },
    assetsInclude: ['**/*.hdr'],
})
