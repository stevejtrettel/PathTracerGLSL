import type { ModuleDescriptor } from "../../src/engine/types";

/**
 * Simple test module that outputs red color
 * Used to verify the entire Engine pipeline works end-to-end
 */
const redModule: ModuleDescriptor = {
    id: {
        kind: 'test',
        name: 'red',
        version: '1.0.0'
    },

    fragment: {
        functions: `
      vec3 test_getColor() {
        return vec3(1.0, 0.0, 0.0);
      }
    `
    },

    exports: ['test_getColor']
};

export { redModule };
