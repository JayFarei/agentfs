---
title: "Hackathon Resources, Top-Level Index"
captured_on: 2026-05-01
type: "orientation"
---

# Resources

Everything we've captured for the MongoDB Agentic Evolution Hackathon: the official event guide, the judging rubric, the full link inventory from the sponsors' resource page, and deep progressive-discovery summaries of every learning resource that's worth more than a one-line mention.

## Progressive discovery

Pick the level that matches your need.

### Level 0, what is this hackathon? (30 seconds)

- [`scope-schedule.md`](./scope-schedule.md), the official Cerebral Valley participant guide. Themes, schedule, rules, banned projects, prizes.

### Level 1, am I going to win? (5 minutes)

- [`judging-criteria.md`](./judging-criteria.md), the rubric extracted as a self-evaluation tool. Eligibility gates, weighted criteria with checklists and scoring slots, prep checklists for each of the three judging rounds.

### Level 2, where do I find a specific tool/doc/sample? (1 minute scan)

- [`resources.md`](./resources.md), the full link inventory captured from the sponsors' Notion page. Every URL across MongoDB, AWS, ElevenLabs, Fireworks AI, LangChain, LiveKit, NVIDIA. Cross-links to the deep summaries below for MongoDB content.

### Level 3, deep dive into a specific resource (3+ minutes)

- [`mongodb/`](./mongodb/), structured summaries of every MongoDB-authored learning resource. Includes:
  - [`mongodb/00-pre-hackathon-webinars/`](./mongodb/00-pre-hackathon-webinars/), the 5-part Modern Data Architecture Mastery webinar series (transcripts captured for 3 of 5)
  - 7 topic folders covering key resources, quickstarts, code samples, chatbots/agents, RAG, memory/caching, Vertex AI
- [`aws/`](./aws/), the AWS Free Tier hackathon participant guide.

### Level 4, the live source

Each resource summary's frontmatter and "Source" section links back to the canonical URL. When precision matters (exact code listings, latest changes, verbatim quotes), open the source.

## Recommended path for hackathon participants

If you have ~2 hours to prepare:

1. **15 min:** read [`scope-schedule.md`](./scope-schedule.md) end to end, especially the themes (section 1) and rules (section 5)
2. **15 min:** print/save [`judging-criteria.md`](./judging-criteria.md) and run through the eligibility checklist with your team
3. **45 min:** pick one of the 3 themes, then walk the recommended path in [`mongodb/README.md`](./mongodb/README.md) for that build (foundations → stack pick → memory/cache → agent promotion → eval)
4. **15 min:** skim [`resources.md`](./resources.md) so you know what partner credits/SDKs you have access to (LangSmith $50, Fireworks AI, ElevenLabs Creator tier, etc.)
5. **30 min reserve:** [`mongodb/00-pre-hackathon-webinars/`](./mongodb/00-pre-hackathon-webinars/) summaries, especially Webinars 2 (Vector Search), 3 (RAG), 4 (AI Agents) which are the core build path

## File map

```
kb/resources/
├── README.md                       ← you are here
├── scope-schedule.md               ← official event guide
├── judging-criteria.md             ← scoring rubric, self-eval
├── resources.md                    ← full link inventory
├── aws/
│   ├── README.md
│   └── participant-guide.md
└── mongodb/
    ├── README.md                   ← MongoDB-content navigator
    ├── 00-pre-hackathon-webinars/  ← 5-webinar series + overview
    ├── 01-key-resources/           ← 7 docs entry points
    ├── 02-quickstarts/             ← 3 hands-on guides
    ├── 03-code-samples/            ← 9 starter repos & tutorials
    ├── 04-chatbots-and-agents/     ← 4 agent build patterns
    ├── 05-rag-and-memory/          ← 4 RAG/memory resources
    ├── 06-memory-and-caching/      ← 2 LangChain integration patterns
    └── 07-vertex-ai/               ← 2 Vertex AI references (low priority for AWS-stack finalists)
```

## Conventions

- Every summary file uses the same template: TL;DR → Key Takeaways → What's Covered → When to dive into the source → Source links
- No em-dashes in any of the captured/written content (commas instead, per CLAUDE.md preference)
- No emojis in our content (source quotes preserve their original formatting where reasonable)
- "Captured" frontmatter dates record when the content was extracted; "source" frontmatter records the canonical URL to refer back to
- Thin or failed source captures are flagged honestly in the affected file's frontmatter or body
