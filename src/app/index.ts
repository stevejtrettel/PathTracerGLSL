// app/index.ts
// Public exports for the app architecture

export { App } from './App.js';

export {
    RenderCoordinator,
    type RenderMode,
    type RenderState,
    type ProgressInfo,
    type ProductionGoal
} from './RenderCoordinator.js';

export {
    TiledRenderer,
    type TileJobConfig,
    type TileGrid,
    type TileJob
} from './TiledRenderer.js';

export {
    STRATEGY_PRESETS,
    type AppConfig,
    type CreateAppOptions,
    type StrategyPreset,
    type RenderProgress,
    type RenderStrategy,
    type SceneDescription,
    type CompiledRenderer
} from './types.js';

// Re-export EventBus and Extension for external use
export { EventBus } from './EventBus.js';
export type { Extension, EventHandler } from './types.js';

// Extensions
export {
    OrbitControls,
    TouchOrbitControls,
    ParameterPanelExtension,
    ProductionPanelExtension,
    KeyboardControls,
    AppShortcutsExtension,
    StatsPanel
} from './extensions/index.js';
