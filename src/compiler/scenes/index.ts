// compiler/scenes/index.ts
// The scene suite: a registry of small scenes, each pinpointing a compiler feature so we
// have something concrete to compile, snapshot, and look at as the migration proceeds.
//
// Each entry pairs a scene with one or more strategies (each strategy is a renderer, keys
// 1-9 in the dev app) plus a default camera pose. `examples/scene-lab.ts` reads a scene
// from here by id (?scene=<id>); the snapshot test compiles every (scene, strategy) pair.

import type { SceneDescription, RenderStrategy } from '../types.js';

import { cornellBox, cornellStrategy } from './cornellBox.js';
import { minimalScene, minimalStrategy, directOnlyStrategy } from './minimalScene.js';
import {
    twoLightScene,
    twoLightPowerStrategy,
    twoLightUniformStrategy,
} from './twoLightScene.js';
import { furnaceBox, furnaceStrategy } from './furnaceBox.js';

export interface SceneSuiteEntry {
    scene: SceneDescription;
    /** One renderer per strategy; the dev app binds them to keys 1-9 in order. */
    strategies: RenderStrategy[];
    /** What this scene is for — which feature(s) it exercises. */
    exercises: string;
    /** Default camera pose (and any other live params) for viewing. */
    initialParameters?: Record<string, unknown>;
}

export const sceneSuite: Record<string, SceneSuiteEntry> = {
    'two-light': {
        scene: twoLightScene,
        strategies: [twoLightPowerStrategy, twoLightUniformStrategy],
        exercises:
            'multi-light CDF dispatcher (lights.length>1); lightSelection power (key 1) vs uniform (key 2)',
        initialParameters: {
            'camera.position': [0, 1.2, 4],
            'camera.target': [0, 0.5, 0],
        },
    },
    furnace: {
        scene: furnaceBox,
        strategies: [furnaceStrategy],
        exercises:
            'emission + energy conservation (F-BOX); expect linear-HDR mean = 0.4 everywhere',
        initialParameters: {
            'camera.position': [0, 0, 0],
            'camera.target': [0, 0, -1],
        },
    },
    cornell: {
        scene: cornellBox,
        strategies: [cornellStrategy],
        exercises: 'region disambiguation (5 white walls → 1 material); {param} albedo; fov uniform',
        initialParameters: {
            'camera.position': [0, 1, 4],
            'camera.target': [0, 1, 0],
        },
    },
    minimal: {
        scene: minimalScene,
        strategies: [minimalStrategy, directOnlyStrategy],
        exercises: 'constant environment; pathtracer vs direct-only strategy from one scene',
        initialParameters: {
            'camera.position': [0, 1, 5],
            'camera.target': [0, 0, 0],
        },
    },
};

export const DEFAULT_SCENE = 'two-light';
