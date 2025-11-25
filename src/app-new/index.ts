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
    STRATEGY_PRESETS,
    type FlexibleAppConfig,
    type StrategyPreset,
    type RenderProgress,
    type ExportFormat,
    type RenderStrategy,
    type SceneDescription,
    type CompiledRenderer
} from './types.js';
