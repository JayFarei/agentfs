---
title: "Judging Criteria, Self-Evaluation Rubric"
source: https://cerebralvalley.ai/e/mongo-db-london-hackathon/details
extracted_from: scope-schedule.md (section 8)
captured_on: 2026-05-01
type: "self-evaluation rubric"
---

# Judging Criteria

Use this as a self-evaluation tool while building. Score yourselves against the same criteria the judges will use, in the same weights they will use, and you'll know where to invest the last hours.

The official process has **three rounds** across **May 2 (round 1)** and **May 7 (rounds 2 and 3)**. Round 1 is the gate to everything else, optimize for it first.

---

## Step 0, Eligibility gates

Confirm these before scoring yourselves. Failing any one disqualifies the project regardless of demo quality.

- [ ] Project is built on the **MongoDB Atlas Sandbox** provided for the hackathon (use the email-invite link to create the project + cluster)
- [ ] MongoDB Atlas is a **core component**, not a bolt-on
- [ ] Project addresses **one of the three required themes**: Prolonged Coordination, Multi-Agent Collaboration, or Adaptive Retrieval
- [ ] Repository is **public**
- [ ] Team size is **4 or fewer** (solo allowed)
- [ ] All work was done **during the event**, no pre-existing code passed off as new
- [ ] At least one team member can attend **MongoDB.local London on May 7** (hard requirement to be eligible for the finals)
- [ ] Project is **not** in the banned list: AI Mental Health Advisor, Basic RAG Applications, Streamlit Applications, Image Analyzers, "AI for Education" Chatbot, AI Job Application Screener, AI Nutrition Coach, Personality Analyzers, anything that gives medical advice
- [ ] You can **clearly identify** your team's original contributions vs. any boilerplate or library code (the only way to avoid the "couldn't tell what was new" disqualification)

---

## Round 1 Rubric, Saturday May 2

Format: **3 minute live demo** plus **1, 2 minutes of Q&A**. Live build only, no slide presentations. Show, don't tell.

### Impact Potential, 20%

Source question: long-term potential for success and impact beyond the hackathon.

- [ ] Long-lasting impact on the industry, the world, or some specific domain?
- [ ] Useful and substantial beyond the scope of the hackathon?
- [ ] Real, identified user/customer (not "everyone who uses the internet")?
- [ ] Worth solving, not just neat?

**Self-score:** _____ / 20

### Live Demo, 45%

Source question: how well has the team implemented the core idea, does it work live, how is it presented?

- [ ] Demo works live without crashing
- [ ] Demonstrates the actual problem statement, not a sanitized happy path
- [ ] No dead time: no apologies, loading spinners, "let me just open the right tab"
- [ ] The **agentic behaviors** (the hackathon's actual subject) are visible to the judge in the 3 minutes, not hidden behind a UI
- [ ] One-line architecture beat early so the judge knows what they're watching
- [ ] Recovery plan if something goes wrong (don't restart, don't apologize, narrate forward)

**Self-score:** _____ / 45

### Creativity and Originality, 35%

Source question: has this been seen before, what differentiates it, does it tackle the theme uniquely?

- [ ] Concept has not been seen before in any obvious form
- [ ] A clear differentiator vs. the closest existing thing
- [ ] Novel innovation in its respective field, not a wrapper
- [ ] Tackles one of the three themes in a way another team in the same room would not realistically build

**Self-score:** _____ / 35

**Total Round 1: _____ / 100**

---

## Round 2, MongoDB.local Community Vote, May 7

If you're in the Top 6:

- Your demo lives in Cerebral Valley's **showcase area** at MongoDB.local
- Attendees vote at the gallery: <https://cerebralvalley.ai/e/mongo-db-london-hackathon/hackathon/gallery> (one vote per attendee)
- The Top 3 by community vote proceed to mainstage

This round rewards a **standalone-attractive** demo, not a great pitch. Different optimization than Round 1.

### Showcase prep checklist

- [ ] Demo works **without a team member driving it**: looping video, auto-reset, or clear "click here" affordance
- [ ] Headline signage so a passing attendee understands the value prop in 5 seconds
- [ ] Single, obvious CTA: "scan QR / vote here"
- [ ] At least one team member present to answer drive-by questions
- [ ] If the demo needs network or auth, prepare for the venue Wi-Fi failing

---

## Round 3, MongoDB.local Mainstage, May 7

Notification at **2:00 PM** on the day. Top 3 only.

Format: **3 minute presentation** plus **2 minute Q&A**.

Same three criteria as Round 1 (Impact Potential, Live Demo, Creativity), **equal weighting**, each ~33.3%.

### Mainstage prep checklist

- [ ] 3-minute version of the demo, drilled enough to recover from any single failure point
- [ ] Q&A talking points: what's hard about this problem, what would the next 6 months look like, why MongoDB Atlas specifically (not "we needed a database")
- [ ] Backup plan for the live demo: pre-recorded video segment, screenshots, or a deterministic local fallback
- [ ] One sentence each, ready to deliver: the problem, the insight, the result

---

## Parallel Track, Best Use of ElevenLabs

Judged **separately and asynchronously** across all projects (not just finalists). If you use ElevenLabs:

- [ ] Voice/audio is **load-bearing** in the experience, removing it would meaningfully degrade the product
- [ ] Specific ElevenLabs feature is identifiable in the demo (Conversational AI, voice clones, ElevenReader, etc.)
- [ ] You submitted to <https://showcase.elevenlabs.io> after the event (per ElevenLabs sponsor instructions)

**Prize:** 6 months of Scale tier per team member ($1,980 value per person).

---

## Process reminders (not scored, but disqualifying if missed)

- Submission deadline: **5:00 PM, Saturday May 2** at <https://cerebralvalley.ai/e/mongo-db-london-hackathon/hackathon/submit>
- Submission needs: **1-minute demo video**, **public repo URL**, all team members added on the form
- The judges will explicitly check that work was built during the event, the demo must clearly distinguish original code from anything you started with, immediate disqualification otherwise
- No slide presentations in any round

## Cross-references

- Full participant guide: [`scope-schedule.md`](./scope-schedule.md)
- Mission/positioning of the team's project: [`../mission.md`](../mission.md)
- MongoDB resource deep summaries (for the "MongoDB Atlas as core component" gate): [`mongodb/`](./mongodb/)
- ElevenLabs hacker guide and credit redemption: [`resources.md` ElevenLabs section](./resources.md)
