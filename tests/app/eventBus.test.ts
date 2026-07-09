import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/app/EventBus.js';

describe('EventBus', () => {
    it('delivers events to subscribers', () => {
        const bus = new EventBus();
        const seen: unknown[] = [];
        bus.on('e', d => seen.push(d));
        bus.emit('e', 42);
        expect(seen).toEqual([42]);
    });

    it('emitting an event with no listeners is a no-op', () => {
        expect(() => new EventBus().emit('nobody')).not.toThrow();
    });

    it('once fires exactly once', () => {
        const bus = new EventBus();
        const fn = vi.fn();
        bus.once('e', fn);
        bus.emit('e');
        bus.emit('e');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('a once() handler unsubscribing mid-dispatch does not skip a co-registered handler', () => {
        // The snapshot-iteration fix: splicing the live array during dispatch used to skip
        // the listener that shifts into the vacated slot.
        const bus = new EventBus();
        const other = vi.fn();
        bus.once('e', () => {});
        bus.on('e', other);
        bus.emit('e');
        expect(other).toHaveBeenCalledTimes(1);
    });

    it('one throwing handler does not stop the others', () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const bus = new EventBus();
        const after = vi.fn();
        bus.on('e', () => { throw new Error('boom'); });
        bus.on('e', after);
        expect(() => bus.emit('e')).not.toThrow();
        expect(after).toHaveBeenCalledTimes(1);
        errSpy.mockRestore();
    });

    it('off removes a handler and deletes the event key when empty', () => {
        const bus = new EventBus();
        const fn = () => {};
        bus.on('e', fn);
        expect(bus.listenerCount('e')).toBe(1);
        expect(bus.eventNames()).toContain('e');
        bus.off('e', fn);
        expect(bus.listenerCount('e')).toBe(0);
        expect(bus.eventNames()).not.toContain('e');
    });

    it('removeAllListeners clears a single event or all events', () => {
        const bus = new EventBus();
        bus.on('a', () => {});
        bus.on('b', () => {});
        bus.removeAllListeners('a');
        expect(bus.eventNames()).toEqual(['b']);
        bus.removeAllListeners();
        expect(bus.eventNames()).toEqual([]);
    });
});
