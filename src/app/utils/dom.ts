/**
 * DOM utilities
 */

/**
 * Check if a keyboard event originated from a text input element
 *
 * Use this to skip keyboard shortcuts when user is typing in a form field.
 *
 * @param e - Keyboard event
 * @returns true if the event target is an input, textarea, or select element
 *
 * @example
 * window.addEventListener('keydown', (e) => {
 *     if (isTypingInInput(e)) return;
 *     // Handle keyboard shortcut...
 * });
 */
export function isTypingInInput(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement;
    return (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
    );
}
