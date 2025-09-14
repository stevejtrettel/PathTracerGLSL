/**
 * Purpose: Generate a deterministic cache key for program reuse based on module IDs/versions, formats, and coarse resolution bin.
 * Public contract: function featureHash({modules, formats, width, height}) → string
 * Inputs: Ordered list of modules, declared resource formats, width/height (quantized e.g. >>3).
 * Outputs: Opaque string used by callers (Program cache) to decide rebuild vs reuse.
 * Lifecycle: Compute on build; recompute only when inputs change.
 * Invariants: Pure function; value changes iff program shape should change; independent of uniform values.
 */
