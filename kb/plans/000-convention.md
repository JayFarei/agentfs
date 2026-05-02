---
title: "ref: Plan Convention"
summary: "Defines the standard format for all plan documents"
type: ref
status: evergreen
date: 2026-05-01
related_research: []
---

# Plan Convention

This file defines the standard format for all plan documents in `plans/`. It serves as a living template, future plans should follow this structure.

---

## File Naming

Pattern: `NNN-kebab-slug.md`

- **NNN**: Three-digit, zero-padded sequential number (001, 002, ... 999)
- **kebab-slug**: Lowercase, hyphen-separated descriptive name
- Examples: `001-persona-rubric-harness.md`, `014-trace-viewer-parser-quality.md`
- Gaps in numbering are fine (retired plans are deleted or moved to archive/, not renumbered)

---

## Frontmatter

```yaml
---
title: "type: Descriptive Title"
summary: "One-sentence description of what this plan delivers"
type: feat | ops | fix | refactor | ref
status: proposed | backlog | in-progress | done | blocked | cancelled
date: YYYY-MM-DD
related_research:
  - kb/br/NN-slug.md
---
```

**Fields:**
- `title`: Prefixed with the plan type and a colon: `feat:`, `ops:`, `fix:`, `refactor:`, `ref:`
- `summary`: One sentence describing the deliverable, not the problem
- `type`: Category: `feat` (new feature), `ops` (operational/infrastructure), `fix` (bug fix), `refactor` (code restructuring), `ref` (reference/convention document)
- `status`: Lifecycle stage: `proposed` (idea, not yet scoped), `backlog` (scoped, not started), `in-progress` (actively being worked), `done` (shipped), `blocked` (waiting on dependency), `cancelled` (abandoned with reason)
- `date`: Date the plan was created
- `related_research`: Optional list of paths to relevant `br/` files that informed this plan

---

## Section Template

### Overview

What this plan delivers, in two to three sentences. The reader should understand the scope and outcome without reading further.

### Problem Frame

Why this matters. Who is affected (the ICP or internal user), what breaks or degrades without it, and why now is the right time. Ground this in evidence, not assumption, reference research, user feedback, or observed failures.

### Requirements Trace

Numbered requirements that define the acceptance criteria:

- R1. [Testable, specific requirement]
- R2. [Another requirement]
- R3. ...

Each requirement should be pass/fail verifiable. Avoid subjective language ("should be fast") in favor of measurable criteria ("p95 latency < 200ms").

### Scope Boundaries

What is explicitly NOT in scope. This section is mandatory, it prevents scope creep by drawing a clear line around what this plan does not address. Frame as "No X" statements:

- No changes to [adjacent system]
- No support for [out-of-scope use case]
- No migration of [existing data]

### Context & Research

Links to relevant `br/` files, prior art, external references, and any background that informed this plan. Briefly explain what each reference contributes to the design.

### Architecture

How the pieces fit together. Include ASCII diagrams for data flow or component relationships. Use tables for file/module responsibilities:

| Component | Responsibility |
|-----------|---------------|
| `module_a.py` | Handles X |
| `module_b.py` | Handles Y |

### Milestones

Numbered milestones breaking the work into deliverable chunks. Each milestone includes an effort estimate:

1. **Milestone name**: Description of deliverable. *Effort: Quick (< 1h) / Short (< 4h) / Medium (< 1d) / Large (> 1d)*
2. **Next milestone**: ...

### Files to Modify

Table of files that will be created or changed:

| File | Changes |
|------|---------|
| `src/module/file.py` | Add new function for X |
| `tests/test_file.py` | Add tests for X |

### Verification

Numbered acceptance checklist. Each item is pass/fail:

1. [Specific verification step]
2. [Another verification step]
3. ...

### Decision Audit Trail

Table recording key architectural and design decisions made during planning:

| # | Phase | Decision | Classification | Principle | Rationale |
|---|-------|----------|---------------|-----------|-----------|
| 1 | Design | Chose X over Y | Architecture | Simplicity | Y adds complexity without proportional benefit |
| 2 | Scope | Excluded Z | Scope | Focus | Z is a separate concern, tracked in plan NNN |
