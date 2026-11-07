// demos/photo/index.ts — scenes composed to look like photographs. All but photo-glass read Poly
// Haven assets from the gitignored public/trial/ (run `node tools/fetch-trial-assets.mjs` first).
// Every entry is async (built only when the lab opens it), so the registry-iterating tests, which
// cannot load those files, skip them all alike. Render them on the GPU with
// `npm run shoot -- <id> --size 1280x853`.

import type { AsyncSceneSuiteEntry } from '../../tests/witnesses/types.js';
import { photoStudioEntry } from './studioScene.js';
import { photoSpongeEntry } from './spongeScene.js';
import { photoPlazaEntry } from './plazaScene.js';
import { photoWindowEntry } from './windowScene.js';
import { photoGlassEntry } from './glassScene.js';
import { photoPavilionEntry } from './pavilionScene.js';

export const photoScenes: Record<string, AsyncSceneSuiteEntry> = {
    'photo-studio': photoStudioEntry,
    'photo-sponge': photoSpongeEntry,
    'photo-plaza': photoPlazaEntry,
    'photo-window': photoWindowEntry,
    'photo-glass': photoGlassEntry,
    'photo-pavilion': photoPavilionEntry,
};
