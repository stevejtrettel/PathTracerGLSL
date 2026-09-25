import { describe, it, expect, vi } from 'vitest';
import { ParameterStore } from '../../src/app/ParameterStore.js';
import type { ParameterChanges } from '../../src/app/types.js';

function withOnChange(store: ParameterStore) {
    const calls: ParameterChanges[] = [];
    store.onChange = c => calls.push(c);
    return calls;
}

describe('ParameterStore — set / notify', () => {
    it('set fires onChange with old and new values', () => {
        const store = new ParameterStore();
        const calls = withOnChange(store);
        store.set('a', 1);
        expect(calls.at(-1)!.changes).toEqual([{ path: 'a', oldValue: undefined, newValue: 1 }]);
    });

    it('setting an equal primitive does not fire onChange', () => {
        const store = new ParameterStore();
        store.set('a', 1);
        const calls = withOnChange(store); // clears history via fresh array; onChange re-set below
        calls.length = 0;
        store.set('a', 1);
        expect(calls).toHaveLength(0);
    });

    it('setting an element-wise equal typed array does not fire onChange', () => {
        const store = new ParameterStore();
        store.set('v', new Float32Array([1, 2, 3]));
        const calls = withOnChange(store);
        calls.length = 0;
        store.set('v', new Float32Array([1, 2, 3]));
        expect(calls).toHaveLength(0);
    });

    it('setting a deep-equal but non-array object DOES fire (valuesEqual only handles arrays)', () => {
        const store = new ParameterStore();
        store.set('o', { x: 1 });
        const calls = withOnChange(store);
        calls.length = 0;
        store.set('o', { x: 1 });
        expect(calls).toHaveLength(1);
    });
});

describe('ParameterStore — onChange setter replay', () => {
    it('assigning onChange immediately replays existing params with oldValue undefined', () => {
        const store = new ParameterStore();
        store.set('a', 1);
        store.set('b', 2);
        const calls: ParameterChanges[] = [];
        store.onChange = c => calls.push(c);
        expect(calls).toHaveLength(1);
        expect(calls[0].changes).toEqual([
            { path: 'a', oldValue: undefined, newValue: 1 },
            { path: 'b', oldValue: undefined, newValue: 2 },
        ]);
    });
});

describe('ParameterStore — lock', () => {
    it('drops set and batch while locked (with a warning) and leaves values unchanged', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const store = new ParameterStore();
        store.set('a', 1);
        const calls = withOnChange(store);
        calls.length = 0;
        store.lock();
        store.set('a', 99);
        store.batch({ b: 5 });
        expect(store.get('a')).toBe(1);
        expect(store.get('b')).toBeUndefined();
        expect(calls).toHaveLength(0);
        store.unlock();
        store.set('a', 99);
        expect(store.get('a')).toBe(99);
        warn.mockRestore();
    });
});

describe('ParameterStore — resendAll', () => {
    it('re-emits every param with oldValue === newValue (the resend sentinel)', () => {
        const store = new ParameterStore();
        store.set('a', 1);
        const calls = withOnChange(store);
        calls.length = 0;
        store.resendAll();
        expect(calls[0].changes).toEqual([{ path: 'a', oldValue: 1, newValue: 1 }]);
    });
});

describe('ParameterStore — restore / serialize', () => {
    it('restore copies arrays and emits one batch (E11: the camera.frame coercion fossil is gone)', () => {
        const store = new ParameterStore();
        const calls = withOnChange(store);
        calls.length = 0;
        store.restore({ 'camera.position': [1, 2, 3], other: 7 });
        expect(store.get('camera.position')).toEqual([1, 2, 3]);
        expect(calls).toHaveLength(1); // single batch, not per-item
        expect(calls[0].changes.every(c => c.oldValue === undefined)).toBe(true);
    });

    it('serialize converts typed arrays to plain arrays', () => {
        const store = new ParameterStore();
        store.set('v', new Float32Array([1, 2]));
        store.set('n', 3);
        const s = store.serialize();
        expect(Array.isArray(s.v)).toBe(true);
        expect(s.v).toEqual([1, 2]);
        expect(s.n).toBe(3);
    });
});

describe('ParameterStore.restore — keys the session lacks', () => {
    it('reports them with newValue undefined, so the engine returns them to defaults', () => {
        const store = new ParameterStore();
        store.set('a', 1);
        store.set('b', 2);
        const batches: Array<{ path: string; oldValue: unknown; newValue: unknown }[]> = [];
        store.onChange = (e) => { batches.push(e.changes); };   // (assigning replays current values)
        store.restore({ a: 5 });
        expect(batches.at(-1)).toEqual([
            { path: 'a', oldValue: undefined, newValue: 5 },
            { path: 'b', oldValue: 2, newValue: undefined },
        ]);
        expect(store.get('b')).toBeUndefined();
    });
});
