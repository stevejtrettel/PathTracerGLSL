import { describe, it, expect, vi } from 'vitest';
import { AppShortcutsExtension } from '../../src/app/extensions/AppShortcutsExtension.js';

describe('picture shortcuts during production', () => {
    it.each(['m', 'M'])('allows %s while parameters are locked', (key) => {
        const showPicture = vi.fn();
        const extension = new AppShortcutsExtension();
        const shortcut = extension as unknown as {
            app: unknown; handleKeyDown(e: KeyboardEvent): void;
        };
        shortcut.app = {
            isLocked: () => true, getAvailableRendererIds: () => [],
            getPictures: () => ['radiance', 'variance'], getDisplayedPicture: () => 'radiance',
            showPicture,
        };
        shortcut.handleKeyDown({ key, target: { tagName: 'CANVAS' }, preventDefault() {} } as unknown as KeyboardEvent);
        expect(showPicture).toHaveBeenCalledWith('variance');
    });
});
