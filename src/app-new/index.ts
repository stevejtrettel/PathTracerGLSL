// app-new/index.ts
// Public exports for the new app architecture

export { FlexibleApp } from './FlexibleApp.js';

export {
    FlexibleRenderCoordinator,
    type RenderMode,
    type RenderState,
    type ProgressInfo,
    type ProductionGoal
} from './FlexibleRenderCoordinator.js';

export {
    TiledRenderer,
    type TileJobConfig,
    type TileGrid,
    type TileJob
} from './TiledRenderer.js';

export {
    STRATEGY_PRESETS,
    type FlexibleAppConfig,
    type StrategyPreset,
    type RenderProgress,
    type ExportFormat,
    type RenderStrategy,
    type SceneDescription,
    type CompiledRenderer
} from './types.js';

// Re-export EventBus and Extension for external use
export { EventBus } from '../app/EventBus.js';
export type { Extension, EventHandler } from '../app/types.js';

// Extensions
export { OrbitControls, TouchOrbitControls } from './extensions/index.js';
