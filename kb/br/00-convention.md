---
title: "Background Research Convention"
date: 2026-05-01
mode: reference
sources: 0
status: evergreen
---

# Background Research Convention

This file defines the standard format for all background research documents in `br/`. It serves as a living template, future research files should follow this structure.

---

## File Naming

Pattern: `NN-kebab-slug.md`

- **NN**: Two-digit, zero-padded sequential number (01, 02, ... 99)
- **kebab-slug**: Lowercase, hyphen-separated descriptive name
- Examples: `01-code-agent-trace-formats.md`, `15-community-jsonl-parsers.md`
- Gaps in numbering are fine (retired research is deleted, not renumbered)

---

## Frontmatter

```yaml
---
title: "Descriptive Title of the Research Subject"
date: YYYY-MM-DD
mode: ultradeep | deep | scan | reference
sources: N | "N+"
status: complete | draft | stale | evergreen
---
```

**Fields:**
- `title`: Full descriptive title, not abbreviated
- `date`: Date the research was conducted
- `mode`: Depth of research: `ultradeep` (comprehensive, 40+ sources), `deep` (thorough, 15-30 sources), `scan` (quick survey, 5-15 sources), `reference` (single-source or convention doc)
- `sources`: Number of sources consulted, or "N+" for approximate counts
- `status`: `complete` (finished, conclusions drawn), `draft` (in progress), `stale` (outdated, may need refresh), `evergreen` (convention/reference, always current)

---

## Section Template

### Executive Summary

Two to three paragraph synthesis of findings. Lead with the bottom line, what does this research mean for the project? Then provide supporting context. A reader who only reads this section should walk away with the key insight.

### Overview

What the subject is. Include traction and adoption signals where available (GitHub stars, community size, funding, notable adopters). Why it matters in the current landscape.

### How It Works

Technical depth: architecture, API surface, data model, key abstractions. Include ASCII diagrams, code snippets, or schema examples where they clarify. This section should give a reader enough understanding to evaluate the technology without needing to read the original documentation.

### Strengths

What it does well, validated by evidence (benchmarks, adoption data, community feedback), not speculation. Be specific, "fast" is not a strength, "processes 10K traces/sec on a single node" is.

### Limitations & Risks

What it does poorly, what's missing, risks of adoption. Include both technical limitations and strategic risks (vendor lock-in, abandoned maintenance, license concerns).

### Integration Analysis

Project-specific fit assessment. Answer three questions:
1. **What to extract**: Which ideas, patterns, or code can the project adopt?
2. **Bootstrap path**: How would adoption start? What's the minimal integration?
3. **Effort estimate**: Quick (< 1h), Short (< 4h), Medium (< 1d), Large (> 1d)

### Key Takeaways

Two to four numbered bullets. Each one should be actionable or decision-relevant for the project. Not a summary of the above sections, these are the "so what" conclusions.

### Sources

Bulleted links with brief description of each source. Group by type if there are many (official docs, community discussions, academic papers).
