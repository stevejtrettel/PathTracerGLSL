/**
 * Formatting utilities
 */

/**
 * Format milliseconds as human-readable time string
 *
 * @param ms - Time in milliseconds
 * @returns Formatted string like "5s", "2m 30s", or "1h 15m"
 *
 * @example
 * formatTime(5000)    // "5s"
 * formatTime(150000)  // "2m 30s"
 * formatTime(3900000) // "1h 5m"
 */
export function formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);

    if (seconds < 60) {
        return `${seconds}s`;
    } else if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${mins}m`;
    }
}
