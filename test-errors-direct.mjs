#!/usr/bin/env node

/**
 * Direct test of error reporting system
 * This simulates shader compilation without needing a browser/WebGL context
 */

import { translateShaderErrors, ShaderErrorFormatter } from './src/errors/index.js';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 Direct Test: Error Reporting System');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Simulate a GLSL compilation error
const mockErrorLog = `ERROR: 0:234: 'camera_generateRay' : no matching overloaded function found
ERROR: 0:267: 'camera_generateRay' : no matching overloaded function found
ERROR: 0:345: 'lighting_sample' : no matching overloaded function found`;

// Simulate shader source with module boundaries
const mockSource = `#version 300 es
precision highp float;

// ============ COMMON STRUCTS ============
struct Ray {
    vec3 origin;
    vec3 direction;
    float tmin;
    float tmax;
};

// ============ RNG SYSTEM ============
uint rng_state;
float random() { return 0.5; }

// ============ pinhole (camera) ============
Ray camera_generate_ray(vec2 pixel, vec2 xi) {
    Ray ray;
    ray.origin = vec3(0.0);
    ray.direction = vec3(0.0, 0.0, -1.0);
    ray.tmin = 0.001;
    ray.tmax = 1000.0;
    return ray;
}

// ============ pathtracer (transport) ============
vec3 transport_trace(Ray ray) {
    // Line 234: Typo here - camera_generateRay instead of camera_generate_ray
    Ray r = camera_generateRay(vec2(0.5), vec2(0.5));

    // Line 267: Same typo again
    r = camera_generateRay(vec2(0.3), vec2(0.7));

    // Line 345: Missing lighting_sample function
    vec3 light = lighting_sample(vec3(0.0));

    return vec3(1.0);
}

out vec4 fragColor;
void main() {
    fragColor = vec4(1.0);
}`;

// Mock module descriptors
const mockModules = [
    {
        id: { kind: 'camera', name: 'pinhole', version: '1.0.0' },
        fragment: {
            functions: `
Ray camera_generate_ray(vec2 pixel, vec2 xi) {
    Ray ray;
    ray.origin = vec3(0.0);
    ray.direction = vec3(0.0, 0.0, -1.0);
    ray.tmin = 0.001;
    ray.tmax = 1000.0;
    return ray;
}

float camera_getPdf(Ray ray) {
    return 1.0;
}`
        }
    },
    {
        id: { kind: 'transport', name: 'pathtracer', version: '1.0.0' },
        fragment: {
            functions: `
vec3 transport_trace(Ray ray) {
    Ray r = camera_generateRay(vec2(0.5), vec2(0.5));
    r = camera_generateRay(vec2(0.3), vec2(0.7));
    vec3 light = lighting_sample(vec3(0.0));
    return vec3(1.0);
}`
        }
    }
];

console.log('📋 Simulating shader compilation with errors...\n');

// Translate errors
const diagnostics = translateShaderErrors(mockErrorLog, mockSource, mockModules);

// Format and display
const formatter = new ShaderErrorFormatter();
const formattedOutput = formatter.formatConsole(diagnostics);

console.log(formattedOutput);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✨ Test Complete!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('Features demonstrated:');
console.log('  ✓ Raw GLSL error parsing');
console.log('  ✓ Module context mapping');
console.log('  ✓ Typo detection with Levenshtein distance');
console.log('  ✓ Function suggestions from auto-extracted declarations');
console.log('  ✓ Error deduplication');
console.log('  ✓ Beautiful ANSI-colored console output');
console.log('  ✓ Actionable error messages');
console.log('');
