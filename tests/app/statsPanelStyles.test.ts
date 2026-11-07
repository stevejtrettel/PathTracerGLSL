import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// UIExtension.hide() only adds the class `hidden` to the root element; the stylesheet must
// say what that class does for each panel. StatsPanel hides itself on `i` and during
// production renders, and stops refreshing its numbers while hidden, so without a rule the
// panel stays on screen with frozen numbers.
const css = readFileSync(
    fileURLToPath(new URL('../../src/app/ui/styles/extensions.css', import.meta.url)),
    'utf8',
);

describe('StatsPanel styles', () => {
    it('removes the panel from view when it carries the hidden class', () => {
        const rule = /\.stats-panel\.hidden\s*\{([^}]*)\}/.exec(css);
        expect(rule).not.toBeNull();
        expect(rule![1]).toMatch(/display:\s*none/);
    });
});
