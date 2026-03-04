# App Pillar Documentation Index

**Status**: 95% complete, production-ready for research

This folder contains complete documentation for the App pillar - the orchestration layer that wires together Engine, parameters, rendering, and extensions.

---

## Quick Start

**If you just want to use the app**:
→ Read [APP_QUICK_REFERENCE.md](./APP_QUICK_REFERENCE.md)

**If you need to understand the architecture**:
→ Read [APP_IMPLEMENTATION.md](./APP_IMPLEMENTATION.md)

**If you're modifying or extending the app**:
→ Read [APP_BUILD_PLAN.md](./APP_BUILD_PLAN.md)

**If you're curious about design decisions**:
→ Read [APP_DESIGN_EVOLUTION.md](./APP_DESIGN_EVOLUTION.md)

---

## Document Purposes

### 1. APP_IMPLEMENTATION.md (Comprehensive Reference)

**When to read**: 
- You're new to the codebase
- You need to modify core App code
- You're debugging a complex issue
- You want to understand architectural decisions

**What it covers**:
- Complete architecture overview
- Detailed API documentation for all classes
- Component interactions and data flow
- Extension system deep dive
- Type definitions
- Usage patterns
- Performance characteristics
- Architectural invariants
- File organization

**Length**: ~30 pages
**Read time**: 1-2 hours

---

### 2. APP_QUICK_REFERENCE.md (Cheat Sheet)

**When to read**:
- You need to do something specific right now
- You forgot the syntax for something
- You're looking up keyboard shortcuts
- You want a code snippet

**What it covers**:
- Setup patterns
- Common operations (organized by task)
- All keyboard shortcuts
- Parameter names
- Event names
- Extension patterns
- Debugging commands
- Troubleshooting

**Length**: ~10 pages
**Read time**: 15 minutes (or just search for what you need)

---

### 3. APP_BUILD_PLAN.md (Development Roadmap)

**When to read**:
- You're adding JSDoc comments
- You're improving type safety
- You're adding error handling
- You're writing tests
- You're planning new features

**What it covers**:
- Current completion status
- Remaining work (prioritized)
- Time estimates
- Build order recommendations
- Future extension ideas
- Maintenance strategy
- Success criteria

**Length**: ~8 pages
**Read time**: 30 minutes

---

### 4. APP_DESIGN_EVOLUTION.md (Historical Context)

**When to read**:
- You're comparing code to design docs
- You're wondering why something was simplified
- You're migrating from old design patterns
- You're curious about trade-offs made

**What it covers**:
- What changed from original design docs
- Why changes were made
- What stayed the same
- Over-engineering indicators
- Migration guide
- Lessons learned

**Length**: ~6 pages
**Read time**: 20 minutes

---

## For Different Roles

### Research User (Just Want to Use It)

Read in this order:
1. APP_QUICK_REFERENCE.md - Setup section
2. APP_QUICK_REFERENCE.md - Common patterns section
3. Keep it open as reference

**Time investment**: 15 minutes
**When to come back**: Never, unless you hit an issue

---

### Extension Developer

Read in this order:
1. APP_QUICK_REFERENCE.md - "Creating Extensions" section
2. APP_IMPLEMENTATION.md - "Extension System" section
3. APP_IMPLEMENTATION.md - Look at existing extensions for patterns

**Time investment**: 45 minutes
**When to come back**: When you need to access core components

---

### Core Maintainer (Modifying App Code)

Read in this order:
1. APP_IMPLEMENTATION.md - Full read
2. APP_DESIGN_EVOLUTION.md - Understand history
3. APP_BUILD_PLAN.md - See what needs doing
4. APP_QUICK_REFERENCE.md - Keep as reference

**Time investment**: 2-3 hours
**When to come back**: Before each modification session

---

### Future Collaborator (Getting Up to Speed)

Read in this order:
1. This index (you're here!)
2. APP_DESIGN_EVOLUTION.md - Understand decisions
3. APP_IMPLEMENTATION.md - Skim for structure
4. APP_QUICK_REFERENCE.md - Keep bookmarked
5. Read code with IMPLEMENTATION.md open

**Time investment**: 3 hours
**When to come back**: Daily for first week

---

## Common Questions

### "I need to add a feature, where do I start?"

1. Check if it can be an extension (99% of cases)
2. If yes: Read APP_QUICK_REFERENCE.md "Creating Extensions"
3. If no: Read APP_IMPLEMENTATION.md to understand what you're modifying
4. Check APP_BUILD_PLAN.md "Future Extensions" for similar ideas

### "Something's broken, how do I debug?"

1. Check APP_QUICK_REFERENCE.md "Troubleshooting" section
2. Check APP_QUICK_REFERENCE.md "Debugging" section
3. Add debug event listeners to see what's happening
4. Read relevant section in APP_IMPLEMENTATION.md

### "The code doesn't match the docs, which is wrong?"

The code is correct. Read APP_DESIGN_EVOLUTION.md to understand why they differ. The implementation is simpler and better than the original design.

### "How do I know what parameters exist?"

1. Check APP_QUICK_REFERENCE.md "Common Parameters" section
2. Look at your recipe definition (modules expose parameters)
3. Add a debug listener: `app.bus.on('parameter.changed', console.log)`

### "How do I [specific task]?"

Search APP_QUICK_REFERENCE.md first. It's organized by task and has code snippets for everything common.

### "Why was [design decision] made?"

Check APP_DESIGN_EVOLUTION.md. It explains all the simplifications and why.

### "What's left to build?"

APP_BUILD_PLAN.md has the complete roadmap with priorities and time estimates.

---

## Key Architectural Concepts

These appear throughout the docs:

**Service Registry Pattern**: Extensions register themselves as services rather than adding methods to App. Clean separation.

**Parameter Locking**: During production mode, parameters are locked to prevent corruption. Automatic and safe.

**Recipe Switching**: Blocked during production. Uses `resendAll()` to update Engine without triggering resets.

**Production Promise**: Production mode returns a Promise. Rejection signals interruption. Allows clean async/await patterns.

**Event Bus**: Loose coupling between components. Extensions communicate via events, not direct calls.

**Session Persistence**: Complete state capture including extension states. Perfect reproducibility.

**Extension State**: Extensions can save/restore state via optional methods. Automatic via SessionManager.

**Tile Jobs**: Large images rendered tile-by-tile using production mode internally. Resume support via sessions.

---

## File Organization

```
Documentation (you are here):
/home/claude/
├── APP_IMPLEMENTATION.md      # Comprehensive reference
├── APP_QUICK_REFERENCE.md     # Cheat sheet
├── APP_BUILD_PLAN.md          # Development roadmap
├── APP_DESIGN_EVOLUTION.md    # Historical context
└── README_APP_DOCS.md         # This file

Source Code:
app/
├── App.ts                     # Main orchestrator
├── ParameterStore.ts          # State management
├── RenderCoordinator.ts       # Execution control
├── SessionManager.ts          # Persistence
├── TiledRenderer.ts           # Production tiling
├── EventBus.ts                # Pub/sub system
├── types.ts                   # Core types
│
├── utils/                     # Helper classes
│   ├── AnimationLoop.ts
│   ├── EventManager.ts
│   └── file-export.ts
│
└── extensions/                # Installed extensions
    ├── KeyboardControls.ts
    ├── OrbitControls.ts
    ├── TouchOrbitControls.ts
    ├── ScreenshotExtension.ts
    ├── HDRExportExtension.ts
    └── StatsPanel.ts
```

---

## What's Working

✅ Core orchestration loop
✅ Parameter management with locking
✅ Interactive and production rendering
✅ Pause/resume support
✅ Session save/restore
✅ Tiled rendering with resume
✅ Extension system with service registry
✅ Three camera control options
✅ File export (PNG + HDR)
✅ Statistics display
✅ Event bus for loose coupling
✅ Utility classes for common patterns

**Everything works.** The App pillar is production-ready.

---

## What's Remaining

⏳ JSDoc comments on public methods (2-3 hours)
⏳ Implementation notes on tricky sections (1 hour)
⏳ Proper types instead of `any` (2 hours)
⏳ Better error handling (1 hour)
⏳ Tests (6-9 hours, optional)

**Total essential work**: 3-4 hours

See APP_BUILD_PLAN.md for detailed breakdown and priorities.

---

## Philosophy

The App pillar follows these principles:

1. **Simple over clever** - Less code, fewer concepts
2. **Explicit over implicit** - Clear intent over magic
3. **Flexible over prescriptive** - Extensions over hard-coding
4. **Stable over cutting-edge** - Boring is good
5. **Documented over self-documenting** - Write it down

The goal: Code you can **set and forget** while you focus on research.

---

## Success Criteria

You know the App pillar is done when:

- ✅ You haven't opened app/ folder in 6 months
- ✅ All your work is in optics/ and objects/
- ✅ Extensions handle any new features you need
- ✅ The app just works, every time
- ✅ You can onboard collaborators in an afternoon

**Current status**: Almost there! Just needs JSDoc polish.

---

## Next Steps

### For Research Use (Immediate)
1. Read APP_QUICK_REFERENCE.md setup section (10 min)
2. Start using the app
3. Don't come back unless you hit an issue

### For Maintenance (Before Forgetting)
1. Add JSDoc comments (3 hours)
2. Add implementation notes (1 hour)
3. Done - set and forget

### For Extension Development (As Needed)
1. Read extension section in QUICK_REFERENCE
2. Write extension
3. Install and use

---

## Final Notes

This documentation represents the complete App pillar as of November 2025. The code is stable, well-structured, and focused on research needs.

The implementation is simpler than the design docs because we learned what was actually needed during development. The result is better.

**Your time is valuable.** The App pillar should be invisible, letting you focus on the interesting work in Optics and Objects. That's why it's thoroughly documented - so you never have to think about it again.

Happy researching!

---

## Version History

- **v1.0 (Nov 2025)**: Initial complete documentation
  - APP_IMPLEMENTATION.md
  - APP_QUICK_REFERENCE.md
  - APP_BUILD_PLAN.md
  - APP_DESIGN_EVOLUTION.md
  - This index
