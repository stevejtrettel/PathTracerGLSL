# Event Bus

Event-driven communication system for decoupled components.

## Overview

The EventBus enables publish-subscribe communication between components without direct dependencies.

**Benefits**:
- **Decoupling** - Components don't need references to each other
- **Flexibility** - Easy to add/remove listeners
- **Debugging** - Central point to monitor all events
- **Extensibility** - Custom events for extensions

---

## API

### on

Subscribe to an event.

```typescript
on(event: string, callback: Function): () => void
```

**Returns**: Unsubscribe function

**Example**:
```typescript
const unsubscribe = app.on('parameters:changed', (changes) => {
    console.log('Params changed:', changes);
});

// Later
unsubscribe();
```

### once

Subscribe to an event once (auto-unsubscribes after first call).

```typescript
once(event: string, callback: Function): () => void
```

**Example**:
```typescript
app.once('recipe:changed', (recipeId) => {
    console.log('Recipe changed to:', recipeId);
    // Will not fire again
});
```

### off

Unsubscribe from an event.

```typescript
off(event: string, callback?: Function): void
```

**Example**:
```typescript
function handler(changes) {
    console.log(changes);
}

app.on('parameters:changed', handler);

// Later
app.off('parameters:changed', handler);  // Remove specific handler
app.off('parameters:changed');           // Remove all handlers
```

### emit

Emit an event.

```typescript
emit(event: string, data?: any): void
```

**Example**:
```typescript
app.emit('custom:event', { foo: 'bar' });
```

### clear

Remove all event listeners.

```typescript
clear(): void
```

---

## Built-in Events

### parameters:changed

Emitted when parameters are updated.

**Payload**:
```typescript
type ParameterChanges = Record<string, {
    prev: any;
    next: any;
}>;
```

**Example**:
```typescript
app.on('parameters:changed', (changes: ParameterChanges) => {
    for (const [path, { prev, next }] of Object.entries(changes)) {
        console.log(`${path}: ${prev} → ${next}`);
    }
});
```

**When Emitted**:
- User updates parameter via UI
- Extension updates parameter
- Recipe switch loads new defaults

### recipe:changed

Emitted when active recipe changes.

**Payload**: `string` (recipe ID)

**Example**:
```typescript
app.on('recipe:changed', (recipeId: string) => {
    console.log('Switched to recipe:', recipeId);
    updateUI(recipeId);
});
```

**When Emitted**:
- `app.selectRecipe(id)` called
- User switches recipe via UI

### render:frame

Emitted after each frame is rendered.

**Payload**:
```typescript
{
    time: number;   // Timestamp (ms)
    delta: number;  // Time since last frame (seconds)
}
```

**Example**:
```typescript
app.on('render:frame', ({ time, delta }) => {
    // Update FPS counter
    const fps = 1 / delta;
    updateFPSDisplay(fps);
});
```

**When Emitted**:
- Every frame in render loop

### accumulation:reset

Emitted when accumulation buffers are cleared.

**Payload**: None

**Example**:
```typescript
app.on('accumulation:reset', () => {
    console.log('Accumulation reset - starting fresh');
    resetSampleCounter();
});
```

**When Emitted**:
- Parameter with `triggersReset` changed
- User manually resets
- Canvas resized

---

## Custom Events

Extensions can define custom events.

### Defining Custom Events

```typescript
class MyExtension implements Extension {
    name = 'my-extension';
    private bus: EventBus;

    initialize(context: ExtensionContext) {
        this.bus = context.bus;

        // Emit custom event
        this.bus.emit('my-extension:ready', {
            version: '1.0.0',
            features: ['feature1', 'feature2']
        });
    }

    private doSomething() {
        // Emit event when action completes
        this.bus.emit('my-extension:action-complete', {
            success: true,
            result: 'data'
        });
    }
}
```

### Listening to Custom Events

```typescript
app.on('my-extension:ready', ({ version, features }) => {
    console.log(`Extension v${version} ready with:`, features);
});

app.on('my-extension:action-complete', ({ success, result }) => {
    if (success) {
        console.log('Action completed:', result);
    }
});
```

---

## Event Naming Conventions

**Built-in events**: `category:action`
- `parameters:changed`
- `recipe:changed`
- `render:frame`
- `accumulation:reset`

**Extension events**: `extension-name:action`
- `screenshot:captured`
- `hdr-export:started`
- `hdr-export:progress`
- `hdr-export:complete`
- `orbit-controls:rotate`

**Custom app events**: `app:action`
- `app:initialized`
- `app:disposed`

---

## Event Patterns

### Request-Response Pattern

```typescript
// Extension A requests data
class ExtensionA implements Extension {
    initialize(context: ExtensionContext) {
        context.bus.emit('data:request', { type: 'config' });

        context.bus.once('data:response', (data) => {
            console.log('Received data:', data);
        });
    }
}

// Extension B provides data
class ExtensionB implements Extension {
    initialize(context: ExtensionContext) {
        context.bus.on('data:request', ({ type }) => {
            const data = this.getData(type);
            context.bus.emit('data:response', data);
        });
    }
}
```

### Progress Reporting Pattern

```typescript
class LongRunningTask implements Extension {
    async performTask(context: ExtensionContext) {
        const total = 100;

        context.bus.emit('task:started', { total });

        for (let i = 0; i < total; i++) {
            await doWork(i);

            context.bus.emit('task:progress', {
                current: i + 1,
                total,
                percent: ((i + 1) / total) * 100
            });
        }

        context.bus.emit('task:complete', { total });
    }
}

// Listen to progress
app.on('task:progress', ({ current, total, percent }) => {
    updateProgressBar(percent);
});
```

### State Change Pattern

```typescript
class StatefulExtension implements Extension {
    private state: 'idle' | 'running' | 'paused' = 'idle';
    private bus: EventBus;

    initialize(context: ExtensionContext) {
        this.bus = context.bus;
    }

    start() {
        this.setState('running');
    }

    pause() {
        this.setState('paused');
    }

    stop() {
        this.setState('idle');
    }

    private setState(newState: typeof this.state) {
        const oldState = this.state;
        this.state = newState;

        this.bus.emit('extension:state-changed', {
            from: oldState,
            to: newState
        });
    }
}
```

---

## Debugging Events

### Log All Events

```typescript
class EventLogger implements Extension {
    name = 'event-logger';

    initialize(context: ExtensionContext) {
        // Intercept emit
        const originalEmit = context.bus.emit.bind(context.bus);

        context.bus.emit = (event: string, data?: any) => {
            console.log(`[Event] ${event}`, data);
            return originalEmit(event, data);
        };
    }
}

app.addExtension(new EventLogger());
```

### Filter Events

```typescript
app.on('*', (event: string, data: any) => {
    if (event.startsWith('parameters:')) {
        console.log(`Parameter event: ${event}`, data);
    }
});
```

### Count Events

```typescript
const eventCounts = new Map<string, number>();

app.on('*', (event: string) => {
    eventCounts.set(event, (eventCounts.get(event) || 0) + 1);
});

setInterval(() => {
    console.table(Array.from(eventCounts.entries()));
}, 5000);
```

---

## Performance Considerations

### Avoid Heavy Listeners

```typescript
// ❌ Bad: Heavy computation every frame
app.on('render:frame', () => {
    expensiveComputation();  // Runs 60 times per second!
});

// ✅ Good: Throttle to once per second
let lastUpdate = 0;
app.on('render:frame', ({ time }) => {
    if (time - lastUpdate > 1000) {
        expensiveComputation();
        lastUpdate = time;
    }
});
```

### Clean Up Listeners

```typescript
class MyExtension implements Extension {
    private unsubscribes: Array<() => void> = [];

    initialize(context: ExtensionContext) {
        // Store unsubscribe functions
        this.unsubscribes.push(
            context.bus.on('event1', this.handler1.bind(this)),
            context.bus.on('event2', this.handler2.bind(this))
        );
    }

    dispose() {
        // Clean up all listeners
        this.unsubscribes.forEach(fn => fn());
        this.unsubscribes = [];
    }
}
```

### Avoid Memory Leaks

```typescript
// ❌ Bad: Creates new listener every frame
app.on('render:frame', () => {
    app.on('parameters:changed', (changes) => {
        // Memory leak! Never cleaned up
    });
});

// ✅ Good: Single listener
let paramHandler: any;

app.on('render:frame', ({ time }) => {
    if (!paramHandler) {
        paramHandler = (changes) => {
            // Handle changes
        };
        app.on('parameters:changed', paramHandler);
    }
});
```

---

## Error Handling

### Catch Errors in Listeners

```typescript
class SafeEventBus extends EventBus {
    emit(event: string, data?: any): void {
        const listeners = this.getListeners(event);

        for (const listener of listeners) {
            try {
                listener(data);
            } catch (error) {
                console.error(`Error in event listener for '${event}':`, error);
                // Emit error event
                super.emit('bus:error', { event, error });
            }
        }
    }
}
```

### Handle Missing Listeners

```typescript
app.on('bus:no-listeners', (event: string) => {
    console.warn(`No listeners for event: ${event}`);
});

// Emit with check
function safeEmit(bus: EventBus, event: string, data?: any) {
    const hasListeners = bus.listenerCount(event) > 0;

    if (!hasListeners) {
        bus.emit('bus:no-listeners', event);
    }

    bus.emit(event, data);
}
```

---

## Advanced Patterns

### Event Queue

```typescript
class EventQueue {
    private queue: Array<{ event: string; data: any }> = [];
    private processing = false;

    enqueue(event: string, data: any) {
        this.queue.push({ event, data });
        this.process();
    }

    private async process() {
        if (this.processing) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const { event, data } = this.queue.shift()!;
            await this.handleEvent(event, data);
        }

        this.processing = false;
    }

    private async handleEvent(event: string, data: any) {
        // Process event
        await someAsyncOperation(data);
    }
}
```

### Event Middleware

```typescript
type Middleware = (event: string, data: any, next: () => void) => void;

class MiddlewareEventBus extends EventBus {
    private middleware: Middleware[] = [];

    use(fn: Middleware) {
        this.middleware.push(fn);
    }

    emit(event: string, data?: any): void {
        let index = 0;

        const next = () => {
            if (index >= this.middleware.length) {
                super.emit(event, data);
                return;
            }

            const fn = this.middleware[index++];
            fn(event, data, next);
        };

        next();
    }
}

// Usage
bus.use((event, data, next) => {
    console.log(`Middleware: ${event}`);
    next();
});
```

---

## Best Practices

1. **Use specific event names** - Avoid collisions
2. **Document custom events** - Help other developers
3. **Clean up listeners** - Prevent memory leaks
4. **Emit immutable data** - Don't modify event payloads
5. **Handle errors** - Don't let listeners crash the app
6. **Throttle high-frequency events** - Avoid performance issues
7. **Use namespaces** - `extension-name:action`
8. **Provide type definitions** - For TypeScript users

---

## Next Steps

- [Extensions](extensions.md) - Using EventBus in extensions
- [Parameter System](parameter-system.md) - Parameter change events
- [App README](README.md) - App layer overview
