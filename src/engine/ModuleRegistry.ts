import type { ModuleDescriptor, ModuleKind, ValidationResult } from './types.js';

/**
 * Central registry for all rendering modules
 * Validates modules follow architectural rules and stores them for compilation
 */
class ModuleRegistry {
    private modules = new Map<string, ModuleDescriptor>();

    /**
     * Register a new module after validation
     */
    register(module: ModuleDescriptor): void {
        // TODO: In future phases, actually check this.validateModule and throw on errors
        // Right now, we trust ourselves and just register everything

        const key = `${module.id.kind}:${module.id.name}`;
        this.modules.set(key, module);

        console.log(`Registered module: ${key}`);
    }

    /**
     * Retrieve a specific module by kind and name
     */
    get(kind: ModuleKind, name: string): ModuleDescriptor {
        const key = `${kind}:${name}`;
        const module = this.modules.get(key);

        if (!module) {
            throw new Error(`Module not found: ${key}`);
        }

        return module;
    }



    /**
     * Validate that a module follows architectural rules
     * Phase 1: Returns valid=true for everything (trust ourselves)
     * Future: Will check exports and scan GLSL source
     */
    private validateModule(module: ModuleDescriptor): ValidationResult {
        // TODO: Define required functions per module kind:
        // const requiredFunctions = {
        //   'camera': ['generateRay'],
        //   'transport': ['trace'],
        //   'interaction': ['surface_shade', 'surface_scatter', 'surface_pdf'],
        //   'test': ['getColor']
        // };

        // TODO: Check that module.exports includes all required functions for its kind
        // Example: camera module must declare 'generateRay' in exports

        // TODO: Scan module.fragment.functions with regex to verify declared functions exist
        // Example: look for /camera_generateRay\s*\(/g in the GLSL source

        // TODO: Check that function names use correct KIND prefix (not module name prefix)
        // Example: camera module should have camera_generateRay, not pinhole_generateRay

        // Phase 1: Trust ourselves, return valid for everything
        return {
            valid: true,
            errors: []
        };
    }
}

export { ModuleRegistry };
