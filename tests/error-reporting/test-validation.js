// Test validation system
// Run with: node tests/error-reporting/test-validation.js

import { validateRecipe, validateModuleUniforms } from '../../src/engine/validation.js';

console.log('🧪 Testing Validation System\n');
console.log('=' .repeat(60));

// ============================================================================
// Test 1: Recipe validation - Wrong module in wrong slot
// ============================================================================

console.log('\n📋 Test 1: Recipe Validation (Wrong Module Kind)');
console.log('-'.repeat(60));

const cameraModule = {
    id: { kind: 'camera', name: 'test-camera', version: '1.0.0' },
    fragment: { functions: '' }
};

const transportModule = {
    id: { kind: 'transport', name: 'test-transport', version: '1.0.0' },
    fragment: { functions: '' }
};

const badRecipe = {
    id: 'test-bad-recipe',
    name: 'Bad Recipe',
    world: {
        ambient: { id: { kind: 'ambient', name: 'test', version: '1.0' }, fragment: { functions: '' } },
        environment: { id: { kind: 'environment', name: 'test', version: '1.0' }, fragment: { functions: '' } },
        scene: { id: { kind: 'scene', name: 'test', version: '1.0' }, fragment: { functions: '' } },
        lighting: { id: { kind: 'lighting', name: 'test', version: '1.0' }, fragment: { functions: '' } }
    },
    optics: {
        camera: cameraModule,
        interaction: { id: { kind: 'interaction', name: 'test', version: '1.0' }, fragment: { functions: '' } },
        transport: cameraModule,  // ❌ Wrong! Camera module in transport slot
        accumulator: { id: { kind: 'accumulator', name: 'test', version: '1.0' }, fragment: { functions: '' } },
        developer: { id: { kind: 'developer', name: 'test', version: '1.0' }, fragment: { functions: '' } }
    }
};

const recipeResult = validateRecipe(badRecipe);
if (!recipeResult.valid) {
    console.log('✅ Correctly detected error:');
    recipeResult.errors.forEach(err => console.log(`   • ${err}`));
} else {
    console.log('❌ Failed to detect error!');
}

// ============================================================================
// Test 2: Uniform validation - Binding references non-existent uniform
// ============================================================================

console.log('\n📋 Test 2: Uniform Validation (Missing Uniform)');
console.log('-'.repeat(60));

const badUniformModule = {
    id: { kind: 'lighting', name: 'test-light', version: '1.0.0' },
    fragment: {
        uniforms: `
            uniform vec3 u_light_position;
            uniform vec3 u_light_radiance;
        `,
        functions: ''
    },
    uniformBindings: [
        {
            uniform: 'u_light_position',
            parameters: ['light.position'],
            type: 'vec3',
            compute: (params) => params['light.position']
        },
        {
            uniform: 'u_lite_color',  // ❌ Typo! Should be u_light_radiance
            parameters: ['light.color'],
            type: 'vec3',
            compute: (params) => params['light.color']
        }
    ]
};

const uniformResult = validateModuleUniforms(badUniformModule);
if (!uniformResult.valid) {
    console.log('✅ Correctly detected error:');
    uniformResult.errors.forEach(err => console.log(`   • ${err}`));
} else {
    console.log('❌ Failed to detect error!');
}

// ============================================================================
// Test 3: Uniform validation - Warning for unbound uniform
// ============================================================================

console.log('\n📋 Test 3: Uniform Validation (Unbound Uniform Warning)');
console.log('-'.repeat(60));

const unboundUniformModule = {
    id: { kind: 'lighting', name: 'test-light-2', version: '1.0.0' },
    fragment: {
        uniforms: `
            uniform vec3 u_light_position;
            uniform vec3 u_light_radiance;
            uniform float u_light_custom_param;  // ⚠️ No binding for this
        `,
        functions: ''
    },
    uniformBindings: [
        {
            uniform: 'u_light_position',
            parameters: ['light.position'],
            type: 'vec3',
            compute: (params) => params['light.position']
        },
        {
            uniform: 'u_light_radiance',
            parameters: ['light.radiance'],
            type: 'vec3',
            compute: (params) => params['light.radiance']
        }
    ]
};

const unboundResult = validateModuleUniforms(unboundUniformModule);
if (unboundResult.warnings && unboundResult.warnings.length > 0) {
    console.log('✅ Correctly detected warning:');
    unboundResult.warnings.forEach(warn => console.log(`   ⚠️  ${warn}`));
} else {
    console.log('❌ Failed to detect warning!');
}

// ============================================================================
// Test 4: Valid module - Should pass
// ============================================================================

console.log('\n📋 Test 4: Valid Module (Should Pass)');
console.log('-'.repeat(60));

const goodModule = {
    id: { kind: 'lighting', name: 'good-light', version: '1.0.0' },
    fragment: {
        uniforms: `
            uniform vec3 u_light_position;
            uniform vec3 u_light_radiance;
        `,
        functions: ''
    },
    uniformBindings: [
        {
            uniform: 'u_light_position',
            parameters: ['light.position'],
            type: 'vec3',
            compute: (params) => params['light.position']
        },
        {
            uniform: 'u_light_radiance',
            parameters: ['light.radiance'],
            type: 'vec3',
            compute: (params) => params['light.radiance']
        }
    ]
};

const goodResult = validateModuleUniforms(goodModule);
if (goodResult.valid) {
    console.log('✅ Module passed validation');
} else {
    console.log('❌ Valid module failed validation!');
    goodResult.errors.forEach(err => console.log(`   • ${err}`));
}

console.log('\n' + '='.repeat(60));
console.log('✅ All validation tests complete!\n');
