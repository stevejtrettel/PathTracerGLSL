# Outputs review cleanup

Date: 2026-10-01. Scope approved by the owner's “lets do it” after the review and
the proposed small cleanup. This implements that cleanup before step 6.

## Evidence and changes

- TiledRenderer builds stamps between asynchronous encodes; capture every stamp in
  the final tile callback, while the render's parameters are still locked.
- Production and tiled jobs retain caller-owned save requests across awaits; copy
  their picture/format pairs at startup. Ordinary saveAll also fixes names and
  stamps before encoding.
- The shortcut lock rejects m/M; allow those display-only keys during production.
- Planner constructs MRT references separately; use pictureBuffer for those too,
  retaining the explicit :0 required by the existing output representation.
- Ordinary and tiled file writing dispatch separately. Share one writer accepting
  top-first four-byte rows (RGBE for HDR, RGBA for PNG). Ordinary captures supply
  reversed rows; stitched tiles already have top-first rows. Keep existing low-level
  HDR construction and PNG encoding utilities; remove the superseded save wrappers.
- Attachment validation checks bounds but not integers; require integer indices.
- Correct the statistic comment that still describes removed main functions.

No API compatibility layer, new file format, duplicate-request policy, parameter
revamp, transport change, or AOV implementation. Step 6 still requires a separate
approved plan satisfying the mathematical gate in the outputs plan.

## Verification and prediction

Compiled output and rendered pixels remain identical. File payloads and row order
remain identical; save declarations and metadata now remain tied to their render.
Add regressions for request mutation, tiled stamp timing, production picture keys,
and invalid attachment numbers. Verify both formats through the shared writer.
Run TypeScript and the full Vitest suite, compare a fresh digest with step 5, and
compare fresh frames with the existing step-5 record. No witness sweep is needed:
sampling and transport are unchanged. Record literal results in CHANGELOG.md.
