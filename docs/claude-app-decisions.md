# App simplification: current status

## Withdrawal — 2026-10-04

The owner rejected continuing with changes whose practical value or adherence to the
simplification goal was not clear. The uncommitted App lifecycle rewrite and subsequent
input-copying/HDR-recovery batch have been removed. Their affected runtime code and
existing tests are back at commit `8a101b6`. Their new tests and browser probes were removed.
The former implementation plan and its continuation are withdrawn, not a pending queue.
Do not reimplement them based on earlier approvals or successful tests.

The previous document and all pre-rollback work are preserved in the recovery copy
recorded in CHANGELOG.md. That copy is historical evidence, not an active specification.

## The owner's goals remain

- Work locally: develop scenes, explore interactively, and render high-resolution art.
- Export independent scene programs for the website and posterity. Each keeps its own
  code version and can include controls and interactive rendering.
- Simplify the app architecture to serve those uses. Do not add infrastructure for
  hypothetical use cases or failures.
- The lab and scene gallery are development/testing infrastructure; they should not
  dictate the app's design.

The app still needs camera controls, a scene-parameter panel, renderer and picture
selection, debug views, start/stop/restart controls, and statistics. The redesign was
about making these responsibilities easier to understand.

Earlier discussions favored cancellation returning to stopped exploration, retaining a
completed full-frame image for inspection/saving/extension, and setup dialogs preserving
run intent. The rollback does not implement or guarantee those choices. They are context
for a future conversation, not authorization to restore the withdrawn machinery.

## How to continue

Follow AGENTS.md. Discuss the existing code and one concrete possible simplification
with the owner before implementing it. Explain what it removes and any behavior it
changes. There is no approved replacement architecture or new implementation batch.
Preserve the separate outputs step-7 plan and spectrum work.
