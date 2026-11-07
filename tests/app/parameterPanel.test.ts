import { describe, it, expect, vi } from 'vitest';
import { ParameterPanelExtension } from '../../src/app/extensions/ParameterPanelExtension.js';
import type { ParameterMetadata } from '../../src/app/types.js';

// The panel's widgets need a DOM, which the node test environment does not have, so these
// tests drive the panel's store-facing methods with a fake App and fake widgets.
type PanelInternals = {
    app: unknown;
    updateQueue: Map<string, unknown>;
    widgets: Map<string, { widget: { setValue(v: unknown): void }; meta: ParameterMetadata }>;
    flushUpdates(): void;
    onParameterChanged(data: { path: string }): void;
};

describe('ParameterPanelExtension', () => {
    it('flushes all queued slider moves as one store write', () => {
        const setParameter = vi.fn();
        const setParameters = vi.fn();
        const panel = new ParameterPanelExtension() as unknown as PanelInternals;
        panel.app = { setParameter, setParameters };
        panel.updateQueue.set('a.x', 1);
        panel.updateQueue.set('b.y', [1, 2, 3]);

        panel.flushUpdates();

        expect(setParameter).not.toHaveBeenCalled();
        expect(setParameters).toHaveBeenCalledTimes(1);
        expect(setParameters).toHaveBeenCalledWith({ 'a.x': 1, 'b.y': [1, 2, 3] });
        expect(panel.updateQueue.size).toBe(0);
    });

    it('shows a parameter set outside the panel on its widget', () => {
        const stored: Record<string, unknown> = { 'camera.position': [1, 2, 3], 'lamp.power': 4 };
        const panel = new ParameterPanelExtension() as unknown as PanelInternals;
        panel.app = { getParameter: (path: string) => stored[path] };
        const position = { setValue: vi.fn() };
        const power = { setValue: vi.fn() };
        panel.widgets.set('camera.position', {
            widget: position, meta: { name: 'Position', type: 'vec3', default: [0, 0, 8] } as ParameterMetadata,
        });
        panel.widgets.set('lamp.power', {
            widget: power, meta: { name: 'Power', type: 'color', default: [1, 1, 1] } as ParameterMetadata,
        });

        panel.onParameterChanged({ path: 'camera.position' });
        panel.onParameterChanged({ path: 'lamp.power' });
        panel.onParameterChanged({ path: 'not.in.panel' });

        expect(position.setValue).toHaveBeenCalledWith([1, 2, 3]);
        // A scalar on a color parameter is shown as a gray triple, as when the widget was built.
        expect(power.setValue).toHaveBeenCalledWith([4, 4, 4]);
    });
});
