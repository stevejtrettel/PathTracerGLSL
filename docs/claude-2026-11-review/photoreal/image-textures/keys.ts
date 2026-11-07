import { witnessSuite } from '/Users/stevetrettel/Code/PathTracerGLSL/tests/witnesses/index.js';
console.log(Object.keys(witnessSuite as object).filter(k => /expr|veach|rough|guides$|furnace$|mesh-furnace|cornell-area$|checker/.test(k)).join(' '));
