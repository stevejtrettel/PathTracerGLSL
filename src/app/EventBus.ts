// app/EventBus.ts

type EventHandler = (data?: any) => void;

/**
 * Simple event bus for loose coupling between components
 * Enables pub/sub communication without direct dependencies
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

        // Clean up empty arrays
        if (handlers.length === 0) {
            this.listeners.delete(event);
        }
    }

    /**
     * Subscribe to an event for one-time notification
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

        // Call handlers in order
        for (const handler of handlers) {
            try {
                handler(data);
            } catch (error) {
                console.error(`Error in event handler for '${event}':`, error);
                // Continue with other handlers even if one fails
            }
        }
    }

    /**
     * Remove all listeners for an event (or all events)
     */
    removeAllListeners(event?: string): void {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }

    /**
     * Get count of listeners for an event
     */
    listenerCount(event: string): number {
        return this.listeners.get(event)?.length || 0;
    }

    /**
     * Get list of all event names with listeners
     */
    eventNames(): string[] {
        return Array.from(this.listeners.keys());
    }
}

export { EventBus };
export type { EventHandler };
