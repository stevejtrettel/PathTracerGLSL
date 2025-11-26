// app/utils/EventManager.ts

/**
 * EventManager - Automatic cleanup of event listeners
 *
 * Tracks all registered listeners and removes them on cleanup.
 * Prevents memory leaks from forgotten removeEventListener calls.
 * Handles both DOM events and EventBus subscriptions.
 */
export class EventManager {
    private domListeners: Array<{
        target: EventTarget;
        event: string;
        handler: EventListener;
        options?: AddEventListenerOptions;
    }> = [];

    private busListeners: Array<{
        bus: any;
        event: string;
        handler: (data?: any) => void;
    }> = [];

    /**
     * Add DOM event listener (automatically tracked for cleanup)
     *
     * @param target - Element to attach listener to
     * @param event - Event name (e.g., 'click', 'keydown')
     * @param handler - Event handler function
     * @param options - Optional addEventListener options
     */
    add<K extends keyof HTMLElementEventMap>(
        target: EventTarget,
        event: K,
        handler: (e: HTMLElementEventMap[K]) => void,
        options?: AddEventListenerOptions
    ): void {
        target.addEventListener(event, handler as EventListener, options);
        this.domListeners.push({ target, event, handler: handler as EventListener, options });
    }

    /**
     * Add EventBus listener (automatically tracked for cleanup)
     *
     * @param bus - EventBus instance
     * @param event - Event name
     * @param handler - Event handler function
     */
    onBus(bus: any, event: string, handler: (data?: any) => void): void {
        bus.on(event, handler);
        this.busListeners.push({ bus, event, handler });
    }

    /**
     * Remove all tracked listeners (both DOM and EventBus)
     */
    removeAll(): void {
        // Remove DOM listeners
        for (const { target, event, handler, options } of this.domListeners) {
            target.removeEventListener(event, handler, options);
        }

        // Remove EventBus listeners
        for (const { bus, event, handler } of this.busListeners) {
            bus.off(event, handler);
        }

        this.domListeners = [];
        this.busListeners = [];
    }
}
