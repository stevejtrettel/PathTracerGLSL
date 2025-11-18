// app/EventBus.ts

type EventHandler = (data?: any) => void;

/**
 * EventBus - Simple pub/sub for loose coupling between components
 *
 * Common events:
 * - render.started, render.stopped, render.complete
 * - render.progress - ProgressInfo
 * - parameter.changed - ParameterChanges
 * - accumulation.reset - { reason: string }
 * - recipe.switched - { recipeId: string }
 * - session.saved, session.loaded
 * - extension.installed - { name: string, version: string }
 */
class EventBus {
    private listeners = new Map<string, EventHandler[]>();

    /**
     * Subscribe to an event
     */
    on(event: string, handler: EventHandler): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(handler);
    }

    /**
     * Unsubscribe from an event
     */
    off(event: string, handler: EventHandler): void {
        const handlers = this.listeners.get(event);
        if (!handlers) return;

        const index = handlers.indexOf(handler);
        if (index > -1) {
            handlers.splice(index, 1);
        }

        if (handlers.length === 0) {
            this.listeners.delete(event);
        }
    }

    /**
     * Subscribe for one-time notification
     */
    once(event: string, handler: EventHandler): void {
        const onceHandler: EventHandler = (data) => {
            handler(data);
            this.off(event, onceHandler);
        };
        this.on(event, onceHandler);
    }

    /**
     * Emit an event to all subscribers
     */
    emit(event: string, data?: any): void {
        const handlers = this.listeners.get(event);
        if (!handlers) return;

        for (const handler of handlers) {
            try {
                handler(data);
            } catch (error) {
                console.error(`Error in event handler for '${event}':`, error);
            }
        }
    }

    /**
     * Remove all listeners for an event (or all events if no event specified)
     */
    removeAllListeners(event?: string): void {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }

    /**
     * Get listener count for an event
     */
    listenerCount(event: string): number {
        return this.listeners.get(event)?.length || 0;
    }

    /**
     * Get all event names that have listeners
     */
    eventNames(): string[] {
        return Array.from(this.listeners.keys());
    }
}

export { EventBus };
export type { EventHandler };
