#!/usr/bin/env node

/**
 * Test script for the shader error reporting system
 *
 * This script:
 * 1. Temporarily breaks a shader module (typo in function name)
 * 2. Attempts to compile to trigger error reporting
 * 3. Shows the beautified error output
 * 4. Reverts the break
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testFile = join(__dirname, 'src/optics/transport/direct-transport.ts');

// Read original content
const originalContent = fs.readFileSync(testFile, 'utf8');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 Testing Error Reporting System');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// Test 1: Introduce typo - change interaction_surface_shade to interaction_surface_shaed
console.log('📝 Test 1: Introducing typo in function name...');
console.log('   Changing: interaction_surface_shade → interaction_surface_shaed');
console.log('');

const brokenContent = originalContent.replace(
    'interaction_surface_shade',
    'interaction_surface_shaed'  // Typo: "shaed" instead of "shade"
);

fs.writeFileSync(testFile, brokenContent);

console.log('✓ Error introduced');
console.log('');
console.log('▶ Now run: npm run dev');
console.log('  (Or load the app in browser to see the error reporting)');
console.log('');
console.log('You should see a beautiful error message like:');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('❌ Missing Function: interaction_surface_shaed');
console.log('');
console.log('Required by: transport module \'direct\'');
console.log('Expected provider: interaction module');
console.log('');
console.log('💡 Suggestion:');
console.log('   Did you mean \'interaction_surface_shade\'? (distance: 1)');
console.log('');
console.log('Available functions in interaction module:');
console.log('   • interaction_surface_shade');
console.log('   • interaction_surface_scatter');
console.log('   • interaction_surface_pdf');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('');

// Create revert script
const revertScript = `#!/usr/bin/env node
import fs from 'fs';
const content = ${JSON.stringify(originalContent)};
fs.writeFileSync('${testFile}', content);
console.log('✓ Reverted test changes');
`;

fs.writeFileSync(join(__dirname, 'revert-test.js'), revertScript);
fs.chmodSync(join(__dirname, 'revert-test.js'), 0o755);

console.log('To revert the test change, run:');
console.log('  node revert-test.js');
console.log('');
