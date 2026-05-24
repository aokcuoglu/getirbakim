# AI Model Strategy for GetirBakim Development

> **Version:** 1.0 — Last updated: 2026-05-24
> **Purpose:** Define which AI model to use for each development phase to maximize quality, efficiency, and correctness.
> **Available Models:** GLM 5.1 (Cloud), Kimi K2.6 (Cloud), DeepSeek V4 Pro

---

## 1. Model Selection Matrix

| Phase / Task | Primary Model | Rationale |
|---|---|---|
| **UI / Design / Layout** | **GLM 5.1** | Superior visual reasoning; excels at Tailwind + shadcn/ui composition, responsive design, and design token application |
| **Research / Codebase Exploration** | **DeepSeek V4 Pro** | Strongest reasoning; best for tracing request flows, data dependencies, multi-file analysis, and architectural understanding |
| **Coding / Implementation** | **Kimi K2.6** | Fastest code generation; strong TypeScript + Next.js + React patterns; efficient at implementing features with minimal cruft |
| **Debugging / Root Cause Analysis** | **DeepSeek V4 Pro** | Best at systematic deduction, log analysis, and separating symptoms from root causes |
| **Code Review** | **DeepSeek V4 Pro** | Most critical and thorough; best at edge-case detection, regression risk analysis, and correctness verification |
| **Git / Release Operations** | **Kimi K2.6** | Fastest at mechanical git operations, changelog generation, PR creation, and release note drafting |
| **Testing (Writing Tests)** | **Kimi K2.6** | Fast at generating test cases following existing patterns |
| **Testing (Test Strategy / Edge Cases)** | **DeepSeek V4 Pro** | Better at identifying untested edge cases and coverage gaps |
| **Refactoring** | **DeepSeek V4 Pro** | Requires careful reasoning about side effects, backwards compatibility, and hidden dependencies |
| **Documentation / README** | **GLM 5.1** | Produces well-structured, readable technical documentation |

---

## 2. Agent Type → Model Mapping

When using the Task tool with subagent types, use this mapping:

| Subagent Type | Model to Use | Notes |
|---|---|---|
| `explore` (Research) | **DeepSeek V4 Pro** | For codebase exploration, finding files, understanding architecture |
| `general` (Multi-step tasks) | **See phase-based rules below** | Choose model based on the dominant task in the prompt |
| Review Agent | **DeepSeek V4 Pro** | Always — correctness and regression safety are paramount |
| Coding Agent | **Kimi K2.6** | For feature implementation and code changes |

---

## 3. Phase-Based Decision Rules

### 3.1 Design & UI Tasks → GLM 5.1

**Use GLM 5.1 when:**
- Creating or modifying UI components (pages, layouts, cards, forms)
- Working with Tailwind CSS classes, spacing, responsive design
- Applying shadcn/ui components and design tokens
- Implementing visual features (animations, transitions, themes)
- Ensuring design consistency with `DESIGN_PATTERNS.md`

**Example prompts:**
```
"Create a product card component using shadcn Card with Tailwind"
"Design a checkout page layout with responsive grid"
"Implement dark mode toggle following the design patterns doc"
```

### 3.2 Coding & Implementation → Kimi K2.6

**Use Kimi K2.6 when:**
- Implementing API endpoints or server actions
- Writing data fetching logic (Prisma queries, Redis caching)
- Adding business logic (pricing, matching, search)
- Creating React hooks (Zustand, TanStack Query)
- Writing form validation (Zod schemas)
- Mechanical refactors (renaming, extracting utilities)
- Any task where speed and volume of code matter

**Example prompts:**
```
"Add a server action to save vehicle selection"
"Implement pagination for the search results"
"Create a Zod schema for the checkout form"
```

### 3.3 Research & Exploration → DeepSeek V4 Pro

**Use DeepSeek V4 Pro when:**
- Understanding unfamiliar parts of the codebase
- Tracing request flows from UI → API → database
- Analyzing data dependencies between modules
- Identifying all consumers of a function/API before changing it
- Assessing the impact of a proposed change
- Understanding supplier integration logic

**Example prompts:**
```
"How does vehicle-to-part matching work in this codebase?"
"Find all places that read the cart state"
"Trace the checkout flow from button click to payment"
```

### 3.4 Debugging → DeepSeek V4 Pro

**Use DeepSeek V4 Pro when:**
- Investigating bugs or failing tests
- Reproducing issues from logs or stack traces
- Root cause analysis of unexpected behavior
- Identifying missing guards, edge cases, or assumptions
- Examining race conditions or async state issues

**Example prompts:**
```
"Investigate why the search returns empty results for certain queries"
"Debug the cart not persisting across page navigations"
"Find why the VIN decoder is failing for European vehicles"
```

### 3.5 Code Review → DeepSeek V4 Pro

**Use DeepSeek V4 Pro when:**
- Reviewing final diffs before committing
- Checking for correctness and edge cases
- Analyzing regression risks
- Identifying test coverage gaps
- Evaluating whether implementation matches requirements

**Example prompts:**
```
"Review the checkout flow changes for edge cases"
"Check if the new vehicle filter has any regression risks"
"Verify the search refactor preserves existing behavior"
```

### 3.6 Git & Release → Kimi K2.6

**Use Kimi K2.6 when:**
- Creating commits with proper messages
- Generating changelogs
- Creating pull requests
- Writing release notes
- Branch management
- Tagging and versioning

**Example prompts:**
```
"Commit the checkout changes with a descriptive message"
"Create a PR for the vehicle selector feature"
"Generate a changelog from commits since v0.2.1"
```

---

## 4. Multi-Phase Workflows

### Feature Development (Standard Flow)

```
1. Research (DeepSeek V4 Pro)   → Understand requirements, find relevant files, plan approach
2. Design/UI (GLM 5.1)          → Build UI components if needed
3. Coding (Kimi K2.6)           → Implement logic, hooks, API routes
4. Debug (DeepSeek V4 Pro)      → Investigate any failures
5. Review (DeepSeek V4 Pro)     → Final review before merge
```

### Bug Fix Flow

```
1. Debug (DeepSeek V4 Pro)      → Reproduce, find root cause
2. Coding (Kimi K2.6)           → Implement the fix
3. Review (DeepSeek V4 Pro)     → Verify fix and check regressions
```

### Refactoring Flow

```
1. Research (DeepSeek V4 Pro)   → Find all references, consumers, dependencies
2. Coding (Kimi K2.6)           → Execute the refactor
3. Review (DeepSeek V4 Pro)     → Ensure no regressions, all consumers updated
```

### Design-Heavy Feature (Landing Page, Admin Panel)

```
1. Design/UI (GLM 5.1)          → Build layout and visual components
2. Coding (Kimi K2.6)           → Wire up data and interactivity
3. Review (DeepSeek V4 Pro)     → Quality check
```

---

## 5. Complex Task Orchestration

For non-trivial tasks, use multiple agents in sequence. The orchestrator (DeepSeek V4 Pro) should:

1. **Plan** — Break the task into phases
2. **Delegate each phase** to the best model
3. **Integrate** results from each phase
4. **Review** the final output

### Orchestration Example

**Task:** "Add a vehicle selector widget to the homepage that saves to user preferences"

```
Phase 1 — Research (DeepSeek V4 Pro):
  - Explore existing VehicleDataProvider and use-garage.ts
  - Find API endpoints for vehicle data
  - Identify where vehicle preferences are stored (Zustand, Supabase)
  - Report: relevant files, current flow, implementation plan

Phase 2 — Design (GLM 5.1):
  - Build VehicleSelectorDialog component using shadcn Dialog + Command
  - Build VehicleSelectorTrigger widget for homepage
  - Create skeleton and empty states
  - Style with Tailwind + design tokens

Phase 3 — Implementation (Kimi K2.6):
  - Connect to server action for saving preferences
  - Wire up Zustand store updates
  - Add loading/error states
  - Register in ShopProvider

Phase 4 — Review (DeepSeek V4 Pro):
  - Check edge cases (no vehicles, network error, stale data)
  - Verify compatibility with existing vehicle context
  - Confirm responsive behavior
```

---

## 6. Model Strengths Cheat Sheet

| | GLM 5.1 | Kimi K2.6 | DeepSeek V4 Pro |
|---|---|---|---|
| **Visual/UI** | ★★★★★ | ★★★☆☆ | ★★★☆☆ |
| **Code speed** | ★★★☆☆ | ★★★★★ | ★★★★☆ |
| **Reasoning** | ★★★☆☆ | ★★★★☆ | ★★★★★ |
| **Code review** | ★★★☆☆ | ★★★☆☆ | ★★★★★ |
| **Debugging** | ★★☆☆☆ | ★★★☆☆ | ★★★★★ |
| **Docs/Writing** | ★★★★★ | ★★★☆☆ | ★★★★☆ |
| **Architecture** | ★★★☆☆ | ★★★☆☆ | ★★★★★ |
| **Git/Release** | ★★★☆☆ | ★★★★★ | ★★★★☆ |

---

## 7. Fallback Rules

- If **GLM 5.1** is unavailable for design tasks → use **DeepSeek V4 Pro** (better visual reasoning than Kimi)
- If **Kimi K2.6** is unavailable for coding → use **DeepSeek V4 Pro** (higher quality but slightly slower)
- If **DeepSeek V4 Pro** is unavailable for review/debug → do NOT skip review. Use **Kimi K2.6** but be extra cautious about edge cases
- **Never** skip the review phase. If all models are unavailable, request human review.

---

## 8. Immutable Rules

1. **Always review before merge.** The Review Agent (DeepSeek V4 Pro) must inspect every non-trivial change.
2. **Research before coding.** Never implement without understanding the existing architecture first.
3. **Design before code for UI.** Use GLM 5.1 for any component that a user will see.
4. **Debug before fixing.** Use DeepSeek V4 Pro to identify root cause, not Kimi to patch symptoms.
5. **Small, reviewable changes.** If a change spans more than ~200 lines, split it into phases.
