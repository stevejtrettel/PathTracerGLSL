// Comprehensive validation test suite
// Tests both recipe and uniform validation

import { validateRecipe, validateModuleUniforms, validateRecipeModules } from '../src/errors/engine/validation.js';

console.log('🧪 Comprehensive Validation Test Suite\n');
console.log('='.repeat(70));

let passCount = 0;
let failCount = 0;

function test(name, fn) {
    try {
        console.log(`\n📋 ${name}`);
        console.log('-'.repeat(70));
        fn();
        passCount++;
        console.log('✅ PASS');
    } catch (error) {
        failCount++;
        console.error('❌ FAIL:', error.message);
        console.error(error.stack);
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

// ============================================================================
// RECIPE VALIDATION TESTS
// ============================================================================

test('Valid recipe passes validation', () => {
    const validRecipe = {
        id: 'test-recipe',
        name: 'Test Recipe',
        world: {
            ambient: { id: { kind: 'ambient', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            environment: { id: { kind: 'environment', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            scene: { id: { kind: 'scene', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            lighting: { id: { kind: 'lighting', name: 'test', version: '1.0' }, fragment: { functions: '' } }
        },
        optics: {
            camera: { id: { kind: 'camera', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            interaction: { id: { kind: 'interaction', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            transport: { id: { kind: 'transport', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            accumulator: { id: { kind: 'accumulator', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            developer: { id: { kind: 'developer', name: 'test', version: '1.0' }, fragment: { functions: '' } }
        }
    };

    const result = validateRecipe(validRecipe);
    assert(result.valid === true, 'Valid recipe should pass');
    assert(result.errors.length === 0, 'Should have no errors');
    console.log('   ✓ Valid recipe accepted');
});

test('Wrong module kind in ambient slot fails', () => {
    const badRecipe = {
        id: 'bad-recipe',
        name: 'Bad Recipe',
        world: {
            ambient: { id: { kind: 'camera', name: 'wrong', version: '1.0' }, fragment: { functions: '' } }, // ❌ Wrong kind
            environment: { id: { kind: 'environment', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            scene: { id: { kind: 'scene', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            lighting: { id: { kind: 'lighting', name: 'test', version: '1.0' }, fragment: { functions: '' } }
        },
        optics: {
            camera: { id: { kind: 'camera', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            interaction: { id: { kind: 'interaction', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            transport: { id: { kind: 'transport', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            accumulator: { id: { kind: 'accumulator', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            developer: { id: { kind: 'developer', name: 'test', version: '1.0' }, fragment: { functions: '' } }
        }
    };

    const result = validateRecipe(badRecipe);
    assert(result.valid === false, 'Invalid recipe should fail');
    assert(result.errors.length === 1, 'Should have one error');
    assert(result.errors[0].includes('ambient slot requires'), 'Error message should mention ambient slot');
    assert(result.errors[0].includes('camera'), 'Error message should mention wrong kind');
    console.log(`   ✓ Error detected: ${result.errors[0]}`);
});

test('Wrong module kind in transport slot fails', () => {
    const badRecipe = {
        id: 'bad-recipe-2',
        name: 'Bad Recipe 2',
        world: {
            ambient: { id: { kind: 'ambient', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            environment: { id: { kind: 'environment', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            scene: { id: { kind: 'scene', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            lighting: { id: { kind: 'lighting', name: 'test', version: '1.0' }, fragment: { functions: '' } }
        },
        optics: {
            camera: { id: { kind: 'camera', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            interaction: { id: { kind: 'interaction', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            transport: { id: { kind: 'camera', name: 'wrong', version: '1.0' }, fragment: { functions: '' } }, // ❌ Wrong kind
            accumulator: { id: { kind: 'accumulator', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            developer: { id: { kind: 'developer', name: 'test', version: '1.0' }, fragment: { functions: '' } }
        }
    };

    const result = validateRecipe(badRecipe);
    assert(result.valid === false, 'Invalid recipe should fail');
    assert(result.errors[0].includes('transport slot requires'), 'Error should mention transport slot');
    console.log(`   ✓ Error detected: ${result.errors[0]}`);
});

test('Multiple wrong modules detected', () => {
    const multiErrorRecipe = {
        id: 'multi-error',
        name: 'Multi Error Recipe',
        world: {
            ambient: { id: { kind: 'camera', name: 'wrong1', version: '1.0' }, fragment: { functions: '' } }, // ❌
            environment: { id: { kind: 'scene', name: 'wrong2', version: '1.0' }, fragment: { functions: '' } }, // ❌
            scene: { id: { kind: 'scene', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            lighting: { id: { kind: 'lighting', name: 'test', version: '1.0' }, fragment: { functions: '' } }
        },
        optics: {
            camera: { id: { kind: 'camera', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            interaction: { id: { kind: 'interaction', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            transport: { id: { kind: 'transport', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            accumulator: { id: { kind: 'accumulator', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            developer: { id: { kind: 'developer', name: 'test', version: '1.0' }, fragment: { functions: '' } }
        }
    };

    const result = validateRecipe(multiErrorRecipe);
    assert(result.valid === false, 'Invalid recipe should fail');
    assert(result.errors.length === 2, 'Should have two errors');
    console.log(`   ✓ Detected ${result.errors.length} errors`);
    result.errors.forEach((err, i) => console.log(`     ${i + 1}. ${err}`));
});

// ============================================================================
// UNIFORM VALIDATION TESTS
// ============================================================================

test('Valid module with matching uniforms passes', () => {
    const validModule = {
        id: { kind: 'lighting', name: 'test-light', version: '1.0' },
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

    const result = validateModuleUniforms(validModule);
    assert(result.valid === true, 'Valid module should pass');
    assert(result.errors.length === 0, 'Should have no errors');
    console.log('   ✓ Valid module accepted');
});

test('Module with no uniforms or bindings passes', () => {
    const emptyModule = {
        id: { kind: 'test', name: 'empty', version: '1.0' },
        fragment: {
            functions: 'vec3 test() { return vec3(0.0); }'
        }
    };

    const result = validateModuleUniforms(emptyModule);
    assert(result.valid === true, 'Module without uniforms should pass');
    console.log('   ✓ Module without uniforms accepted');
});

test('Typo in uniform binding detected', () => {
    const typoModule = {
        id: { kind: 'lighting', name: 'typo-light', version: '1.0' },
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
                uniform: 'u_lite_color', // ❌ Typo! Should be u_light_radiance
                parameters: ['light.color'],
                type: 'vec3',
                compute: (params) => params['light.color']
            }
        ]
    };

    const result = validateModuleUniforms(typoModule);
    assert(result.valid === false, 'Module with typo should fail');
    assert(result.errors.length === 1, 'Should have one error');
    assert(result.errors[0].includes('u_lite_color'), 'Error should mention wrong uniform name');
    assert(result.errors[0].includes('not declared'), 'Error should mention not declared');
    console.log(`   ✓ Error detected: ${result.errors[0]}`);
});

test('Unbound uniform generates warning', () => {
    const unboundModule = {
        id: { kind: 'lighting', name: 'unbound-light', version: '1.0' },
        fragment: {
            uniforms: `
                uniform vec3 u_light_position;
                uniform vec3 u_light_radiance;
                uniform float u_light_custom_param;
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
            // u_light_custom_param has no binding
        ]
    };

    const result = validateModuleUniforms(unboundModule);
    assert(result.valid === true, 'Module should be valid (just warning)');
    assert(result.warnings && result.warnings.length === 1, 'Should have one warning');
    assert(result.warnings[0].includes('u_light_custom_param'), 'Warning should mention unbound uniform');
    console.log(`   ⚠️  Warning: ${result.warnings[0]}`);
});

test('Engine uniforms do not trigger warnings', () => {
    const engineUniformModule = {
        id: { kind: 'camera', name: 'test-camera', version: '1.0' },
        fragment: {
            uniforms: `
                uniform vec2 u_resolution;
                uniform float u_time;
                uniform int u_frameIndex;
            `,
            functions: ''
        }
        // No uniformBindings - these are engine uniforms
    };

    const result = validateModuleUniforms(engineUniformModule);
    assert(result.valid === true, 'Module should be valid');
    assert(!result.warnings || result.warnings.length === 0, 'Engine uniforms should not warn');
    console.log('   ✓ Engine uniforms correctly ignored');
});

test('Multiple uniform errors detected', () => {
    const multiErrorModule = {
        id: { kind: 'lighting', name: 'multi-error-light', version: '1.0' },
        fragment: {
            uniforms: `
                uniform vec3 u_light_position;
                uniform vec3 u_light_radiance;
            `,
            functions: ''
        },
        uniformBindings: [
            {
                uniform: 'u_lite_position', // ❌ Typo
                parameters: ['light.position'],
                type: 'vec3',
                compute: (params) => params['light.position']
            },
            {
                uniform: 'u_lite_color', // ❌ Typo
                parameters: ['light.color'],
                type: 'vec3',
                compute: (params) => params['light.color']
            }
        ]
    };

    const result = validateModuleUniforms(multiErrorModule);
    assert(result.valid === false, 'Module should fail');
    assert(result.errors.length === 2, 'Should have two errors');
    console.log(`   ✓ Detected ${result.errors.length} errors`);
    result.errors.forEach((err, i) => console.log(`     ${i + 1}. ${err}`));
});

// ============================================================================
// RECIPE MODULE VALIDATION TESTS
// ============================================================================

test('validateRecipeModules validates all modules in recipe', () => {
    const recipeWithBadModule = {
        id: 'test-recipe',
        name: 'Test Recipe',
        world: {
            ambient: {
                id: { kind: 'ambient', name: 'test', version: '1.0' },
                fragment: { functions: '' }
            },
            environment: {
                id: { kind: 'environment', name: 'test', version: '1.0' },
                fragment: { functions: '' }
            },
            scene: {
                id: { kind: 'scene', name: 'test', version: '1.0' },
                fragment: { functions: '' }
            },
            lighting: {
                id: { kind: 'lighting', name: 'bad-light', version: '1.0' },
                fragment: {
                    uniforms: `uniform vec3 u_light_position;`,
                    functions: ''
                },
                uniformBindings: [
                    {
                        uniform: 'u_lite_position', // ❌ Typo
                        parameters: ['light.position'],
                        type: 'vec3',
                        compute: (params) => params['light.position']
                    }
                ]
            }
        },
        optics: {
            camera: { id: { kind: 'camera', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            interaction: { id: { kind: 'interaction', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            transport: { id: { kind: 'transport', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            accumulator: { id: { kind: 'accumulator', name: 'test', version: '1.0' }, fragment: { functions: '' } },
            developer: { id: { kind: 'developer', name: 'test', version: '1.0' }, fragment: { functions: '' } }
        }
    };

    const result = validateRecipeModules(recipeWithBadModule);
    assert(result.valid === false, 'Recipe with bad module should fail');
    assert(result.errors.length === 1, 'Should have one error');
    assert(result.errors[0].includes('lighting/bad-light'), 'Error should identify the module');
    assert(result.errors[0].includes('u_lite_position'), 'Error should mention the typo');
    console.log(`   ✓ Error detected in module: ${result.errors[0]}`);
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n' + '='.repeat(70));
console.log('📊 Test Summary');
console.log('='.repeat(70));
console.log(`✅ Passed: ${passCount}`);
console.log(`❌ Failed: ${failCount}`);
console.log(`📈 Total:  ${passCount + failCount}`);

if (failCount === 0) {
    console.log('\n🎉 All tests passed!\n');
    process.exit(0);
} else {
    console.log(`\n⚠️  ${failCount} test(s) failed\n`);
    process.exit(1);
}
