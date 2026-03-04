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
    type TileJob,
    type TileProgressInfo,
    type TiledJobProgressInfo
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

// Re-export EventBus, Extension, and SessionData for external use
export { EventBus } from './EventBus.js';
export type { Extension, EventHandler } from './types.js';
export type { SessionData } from './types.js';

// Event constants and parameter prefixes
export { AppEvents, ParamPrefix, type AppEventName } from './events.js';

// Extensions
export {
    OrbitControls,

    ParameterPanelExtension,
    ProductionPanelExtension,
    KeyboardControls,
    AppShortcutsExtension,
    StatsPanel
} from './extensions/index.js';
