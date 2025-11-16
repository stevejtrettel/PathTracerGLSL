/**
 * Calculate Levenshtein distance between two strings
 * (minimum number of single-character edits required to change one word into another)
 *
 * @param a - First string
 * @param b - Second string
 * @returns Edit distance
 */
export function levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    // Initialize first column
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    // Initialize first row
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

/**
 * Find closest match to target from array of candidates
 *
 * @param target - String to match
 * @param candidates - Array of possible matches
 * @param maxDistance - Maximum acceptable distance (default: 3)
 * @returns Best match with distance, or null if no match within maxDistance
 */
export function findClosestMatch(
    target: string,
    candidates: string[],
    maxDistance: number = 3
): { match: string; distance: number } | null {
    let bestMatch: string | null = null;
    let bestDistance = Infinity;

    for (const candidate of candidates) {
        const distance = levenshteinDistance(target, candidate);
        if (distance < bestDistance && distance <= maxDistance) {
            bestDistance = distance;
            bestMatch = candidate;
        }
    }

    if (bestMatch === null) {
        return null;
    }

    return { match: bestMatch, distance: bestDistance };
}

/**
 * Check if two function names are likely typo variants
 * Handles common patterns:
 * - Underscore vs camelCase: "generate_ray" vs "generateRay"
 * - Letter swaps: "generate" vs "genreate"
 * - Missing/extra characters
 *
 * @param a - First function name
 * @param b - Second function name
 * @returns True if likely same function with typo
 */
export function areLikelyTypos(a: string, b: string): boolean {
    // Exact match (not a typo, but we'll allow it)
    if (a === b) {
        return true;
    }

    // Check Levenshtein distance
    const distance = levenshteinDistance(a, b);

    // Allow up to 3 edits for longer strings, fewer for short strings
    const maxDistance = Math.max(1, Math.floor(Math.min(a.length, b.length) / 4));

    if (distance <= maxDistance) {
        return true;
    }

    // Check underscore vs camelCase variations
    // Convert both to lowercase and remove underscores
    const normalizedA = a.toLowerCase().replace(/_/g, '');
    const normalizedB = b.toLowerCase().replace(/_/g, '');

    if (normalizedA === normalizedB) {
        return true;
    }

    // Check if one is a substring of the other (missing prefix/suffix)
    if (a.includes(b) || b.includes(a)) {
        return true;
    }

    return false;
}

/**
 * Find all candidates within a certain edit distance
 * Useful for showing multiple suggestions
 *
 * @param target - String to match
 * @param candidates - Array of possible matches
 * @param maxDistance - Maximum acceptable distance
 * @returns Array of matches sorted by distance (closest first)
 */
export function findAllMatches(
    target: string,
    candidates: string[],
    maxDistance: number = 3
): Array<{ match: string; distance: number }> {
    const matches: Array<{ match: string; distance: number }> = [];

    for (const candidate of candidates) {
        const distance = levenshteinDistance(target, candidate);
        if (distance <= maxDistance) {
            matches.push({ match: candidate, distance });
        }
    }

    // Sort by distance (closest first)
    matches.sort((a, b) => a.distance - b.distance);

    return matches;
}
