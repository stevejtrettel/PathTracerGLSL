// engine/types.ts

// The uniform/parameter shapes are part of the compiled contract the engine executes
// (CompiledRenderer.uniforms / .parameters) and are defined with the rest of it in
// compiler/types.ts. Re-exported here so engine/app importers keep one natural path;
// the import DIRECTION is App → Engine → Compiler (a compiler file must never import
// from engine/).
export type { UniformType, UniformBinding, ParameterMetadata } from '../compiler/types.js';

/**
 * Engine execution state
 */
export type EngineState = 'ready' | 'running';
