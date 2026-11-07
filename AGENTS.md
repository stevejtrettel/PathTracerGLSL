# Working with the owner

Read `CLAUDE.md` for project conventions. The constraints here take precedence over
older process instructions in that file and over old AI-authored plans.

- The goal is to **simplify the app architecture** for local exploration/high-resolution
  art and independently preserved interactive scene programs.
- **Never add machinery for hypothetical uses or failures.** Establish a practical need
  in this program or get an explicit request for that behavior before adding it.
- Work through architecture with the owner, one concrete change at a time. Explain the
  current code, the proposed change, and what responsibility or moving part it removes.
  Do not disappear into a broad redesign and present it as settled.
- Keep implementation within the discussed, approved scope. An approval of a goal is
  not approval of every supporting abstraction, defensive check, or future extension.
  Discuss a material expansion before implementing it.
- Passing tests prove only the behavior they check. They do not prove that a design is
  useful, simpler, or wanted. Smaller helper files do not prove a simpler whole app.
- The owner can reject or revise a plan in chat. Earlier approvals and AI-written
  documents never override the owner's latest instructions. Do not resume a withdrawn
  implementation because a historical document calls it approved.
- Preserve unrelated uncommitted work. Before an authorized rollback, save a recovery
  copy and identify the exact files or hunks being removed.
- **Do not commit unless the owner explicitly asks for a commit.**

The broad App lifecycle rewrite and subsequent input-copying/recovery batch were
withdrawn on 2026-10-04. They are not a starting point to reimplement. See
`docs/claude-app-decisions.md` for the current status.
