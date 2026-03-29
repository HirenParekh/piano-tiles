# Piano Tiles — Agent Instructions

## 🚨 #1 Rule: Performance is the Highest Priority

Performance is the single most important constraint in this project.
The game must run at a stable 60 FPS on **low-end Android devices** (old phones, Chrome browser).

### What this means in practice

- **Always audit new code for performance before writing it.** If a proposed approach has a performance risk, flag it to the user *before* implementing it — even if the user suggested it themselves.
- **Flag these patterns immediately:**
  - Any allocation inside a per-frame update loop (e.g. `new`, `scene.add.*`, array/object literals)
  - `Graphics.clear()` + full redraw every frame on multiple objects simultaneously
  - Redundant constant recalculations inside update loops (pre-compute and cache as `readonly` fields instead)
  - Registering N individual `scene.events.on('update', ...)` listeners for N simultaneous objects — consolidate into a single manager
  - Tween-based animation for anything that needs frame-perfect accuracy (use time-based physics instead)
  - Object creation during gameplay that triggers GC (use object pools for ripples, particles, etc.)
  - Heavy DOM/CSS operations mixed with Phaser's WebGL loop
- **Prefer:**
  - Pre-computed `readonly` constants in constructors
  - Object pooling for short-lived game objects
  - A single `update` manager that iterates active objects rather than per-object listeners
  - `RenderTexture` or sprite baking for static visuals that don't change frame-to-frame
  - Dirty-flag rendering: only redraw when state actually changed

### When the user proposes a solution

If the user's suggestion would introduce any of the above anti-patterns, **stop and explain the performance concern clearly before writing any code**. Offer a performant alternative. Do not silently implement a known perf-killer.

---

## 📝 #2 Rule: All Code Must Be Thoroughly Commented

Every piece of code written must include rich, explanatory comments. The target reader is someone who understands TypeScript/JavaScript but may not know the game's domain, Phaser's API, or the specific design decisions made.

### What "thorough comments" means

- **File/class-level header** — A block comment at the top of every new file or class explaining:
  - What this object/module is responsible for
  - How it fits into the larger system
  - Any non-obvious constraints or assumptions

- **Section dividers** — Use clear `// ── Section Name ───` dividers to group logical blocks within a class or function, matching the style already used in this codebase.

- **Every non-trivial method** — A JSDoc-style comment (`/** ... */`) above every method explaining:
  - What it does
  - Why it exists (not just what — the *why* is most important)
  - Parameters and return values if non-obvious

- **Every non-obvious line or expression** — Inline comments explaining:
  - Magic numbers and constants (e.g. `* 0.866025 // sqrt(3)/2 — height of equilateral triangle`)
  - Geometry or math derivations
  - Why a particular Phaser API call is used this way
  - Any workaround or gotcha

- **State transitions** — Any time a flag changes (e.g. `isHolding`, `tapped`), comment what that state change means and what it enables/disables.

- **Performance-sensitive paths** — Any code inside an update loop or hot path must have a comment explicitly noting it runs every frame and why it's safe to do so.

### Style guidelines

- Write comments in plain English, full sentences where possible.
- Do not just restate the code (`// sets alpha to 0` ❌). Explain the *intent* (`// hide the follower dot until the first beat fires` ✅).
- Keep comments close to the code they describe — not grouped at the top of a function away from the relevant lines.
