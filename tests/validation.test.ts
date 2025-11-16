// Comprehensive validation test suite using Vitest
import { describe, it, expect } from 'vitest';
import { validateRecipe, validateModuleUniforms, validateRecipeModules } from '../src/errors/engine/validation';
import type { Recipe, ModuleDescriptor } from '../src/engine/types';

describe('Recipe Validation', () => {
    it('should pass validation for a valid recipe', () => {
        const validRecipe: Recipe = {
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
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('should fail when wrong module kind in ambient slot', () => {
        const badRecipe: Recipe = {
            id: 'bad-recipe',
            name: 'Bad Recipe',
            world: {
                ambient: { id: { kind: 'camera', name: 'wrong', version: '1.0' }, fragment: { functions: '' } },
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
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('ambient slot requires');
        expect(result.errors[0]).toContain('camera');
    });

    it('should fail when wrong module kind in transport slot', () => {
        const badRecipe: Recipe = {
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
                transport: { id: { kind: 'camera', name: 'wrong', version: '1.0' }, fragment: { functions: '' } },
                accumulator: { id: { kind: 'accumulator', name: 'test', version: '1.0' }, fragment: { functions: '' } },
                developer: { id: { kind: 'developer', name: 'test', version: '1.0' }, fragment: { functions: '' } }
            }
        };

        const result = validateRecipe(badRecipe);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('transport slot requires');
    });

    it('should detect multiple wrong modules', () => {
        const multiErrorRecipe: Recipe = {
            id: 'multi-error',
            name: 'Multi Error Recipe',
            world: {
                ambient: { id: { kind: 'camera', name: 'wrong1', version: '1.0' }, fragment: { functions: '' } },
                environment: { id: { kind: 'scene', name: 'wrong2', version: '1.0' }, fragment: { functions: '' } },
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
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(2);
    });
});

describe('Uniform Validation', () => {
    it('should pass validation for module with matching uniforms', () => {
        const validModule: ModuleDescriptor = {
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
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('should pass validation for module with no uniforms or bindings', () => {
        const emptyModule: ModuleDescriptor = {
            id: { kind: 'test', name: 'empty', version: '1.0' },
            fragment: {
                functions: 'vec3 test() { return vec3(0.0); }'
            }
        };

        const result = validateModuleUniforms(emptyModule);
        expect(result.valid).toBe(true);
    });

    it('should detect typo in uniform binding', () => {
        const typoModule: ModuleDescriptor = {
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
                    uniform: 'u_lite_color', // Typo!
                    parameters: ['light.color'],
                    type: 'vec3',
                    compute: (params) => params['light.color']
                }
            ]
        };

        const result = validateModuleUniforms(typoModule);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('u_lite_color');
        expect(result.errors[0]).toContain('not declared');
    });

    it('should generate warning for unbound uniform', () => {
        const unboundModule: ModuleDescriptor = {
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
            ]
        };

        const result = validateModuleUniforms(unboundModule);
        expect(result.valid).toBe(true);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings![0]).toContain('u_light_custom_param');
    });

    it('should not warn for engine uniforms', () => {
        const engineUniformModule: ModuleDescriptor = {
            id: { kind: 'camera', name: 'test-camera', version: '1.0' },
            fragment: {
                uniforms: `
                    uniform vec2 u_resolution;
                    uniform float u_time;
                    uniform int u_frameIndex;
                `,
                functions: ''
            }
        };

        const result = validateModuleUniforms(engineUniformModule);
        expect(result.valid).toBe(true);
        expect(result.warnings || []).toHaveLength(0);
    });

    it('should detect multiple uniform errors', () => {
        const multiErrorModule: ModuleDescriptor = {
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
                    uniform: 'u_lite_position', // Typo
                    parameters: ['light.position'],
                    type: 'vec3',
                    compute: (params) => params['light.position']
                },
                {
                    uniform: 'u_lite_color', // Typo
                    parameters: ['light.color'],
                    type: 'vec3',
                    compute: (params) => params['light.color']
                }
            ]
        };

        const result = validateModuleUniforms(multiErrorModule);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(2);
    });
});

describe('Recipe Module Validation', () => {
    it('should validate all modules in a recipe', () => {
        const recipeWithBadModule: Recipe = {
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
                            uniform: 'u_lite_position', // Typo
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
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('lighting/bad-light');
        expect(result.errors[0]).toContain('u_lite_position');
    });
});
