---
title: "The Agentic Evolution Hackathon, Participant Guide"
source: https://cerebralvalley.ai/e/mongo-db-london-hackathon/details
site: "Cerebral Valley"
event_date: 2026-05-02
event_location: "CodeNode, 10 South Pl, London EC2M 7EB, UK"
captured_on: 2026-05-01
captured_by: "user-provided text (defuddle hit SPA shell on capture)"
type: "official participant guide"
---

# The Agentic Evolution Hackathon, Participant Guide

Welcome to the MongoDB Agentic Evolution Hackathon, hacker. We're thrilled to have you on board.

This guide is your all-in-one resource for the event, including schedule, rules, technical resources, problem statements, judging information, and more. Please read this carefully; most answers can be found here.

## 1. Your Goal: Hackathon Themes

These are the **required themes**. Every project must build in one of these three themes.

### 1. Prolonged Coordination

Create an agentic system capable of performing intricate, multi-step workflows that last hours or days, utilizing MongoDB as the context engine, while enduring failures, restarts, and modifications to tasks. How do you execute tool calls, retain reasoning state, recover from single failures, and ensure task consistency in multi-step tasks?

### 2. Multi-Agent Collaboration

Develop a multi-agent system in which specialized agents explore, assign tasks, and communicate with one another, using MongoDB to organize and oversee contexts. How do agents convey their skills, identify suitable peers for a sub-task, share context effectively within token limits, and perform intricate tasks resulting from successful collaborations?

### 3. Adaptive Retrieval

Create an agentic retrieval system that actively fetches from various resources (databases, search indices, multimodal sources, websites, etc.): modifying query approaches, altering chunking, reordering results based on input. How can you create an agentic and adaptive retrieval system that improves over time and performs reasoning across various documents and sources?

## 2. Getting Ready

**Location:** CodeNode (10 South Pl, London EC2M 7EB, United Kingdom)

**Arrival Instructions**

To access the venue, all approved participants are required to sign in on-site upon arrival.

**Wi-Fi Access**

- **Network Name:** CodeNode
- **Password:** EnterSpace.

**Getting to CodeNode:**

- **Underground:** The nearest Tube stations are Moorgate Station and Liverpool Street Station, both less than a 5-minute walk from the venue.
- **Train:** The closest National Rail stations are Liverpool Street Station and King's Cross Station. From King's Cross, it's a 10-minute Tube journey.
- **Bike:** If you're using a Santander Cycles Hire bike, there is a docking station located next to Moorgate Station.

## 3. Connect with the Community

Join the [Agentic Evolution Hackathon Discord](https://discord.gg/GnBNJpXk5) to meet other participants, get official updates, and begin forming teams.

**Getting Started:**

- **Access Hackathon-specific channels:** Once you join, please make sure to read the `#rules` and `#announcement` channels.
- **Introduce yourself:** In `#intros`, share who you are, the skills you bring, and what project you're looking to build.
- **Create a Team:** In `#team-search`, find teammates before the hackathon (maximum team size of four).

**Key Channels:**

- `#general`, socialize and meet other hackers.
- `#rules`, on the day rules spanning from registration, product building, and pitching.
- `#announcements`, official updates and reminders from the CV Team.
- `#intros`, introduce yourself and what you're doing to everyone.
- `#team-search`, find teammates before the hackathon (maximum team size of **four**).
- `#questions`, ask any general questions to the CV Team by pinging `@CV`.

## 4. Schedule Overview

**Saturday, May 2 (Outline)**

| Time | Item |
|------|------|
| 9:00 AM  | Doors Open for Hackers, Breakfast Provided, Team Formation |
| 10:00 AM | Welcome Kick-Off |
| 10:30 AM | Hacking Begins |
| 1:00 PM  | Lunch |
| 5:00 PM  | Submissions Due |
| 5:15 PM, 6:45 PM | First Round Judging |
| 6:00 PM  | Dinner |
| 7:00 PM  | Top 6 Demos, Closing Remarks |
| 9:00 PM  | Doors Close |

## 5. Hackathon Rules

- **Requirement for Finalists:** Teams selected as finalists **must build their project using the MongoDB Atlas Sandbox provided for the hackathon**. Projects that do not **will not be eligible for final judging or prizes**.
  - **Atlas Sandbox Access:** Participants should have received an email with a link to join the **MongoDB Atlas Sandbox for the hackathon**. Please use this link to create your project environment. To be eligible as a finalist, your hackathon project **must be built within this sandbox cluster**.

- **Open Source:** Repositories **must be public**.

- **Team Size:** A **maximum of four** team members per team. Solo participants are allowed.

- **Demo Requirements:** Your demo **must only highlight the specific features, code, and functionality that your team built during the hackathon**. Judges must be able to clearly identify what was created during the event. Failure to clearly identify your original contributions will result in immediate disqualification.

- **New Work Only:** You may not present an existing project as your own work. Failure to clearly distinguish your contributions will result in immediate disqualification.

- **Banned Projects:** Projects will be **disqualified** if they: violate legal, ethical, or platform policies, use code, data, or assets you do not have the rights to.

**Sample Anti-Projects to NOT DO, STRICTLY NO:**

- AI Mental Health Advisor
- Basic RAG Applications
- Streamlit Applications
- Image Analyzers
- "AI for Education" Chatbot
- AI Job Application Screener
- AI Nutrition Coach
- Personality Analyzers
- Any project using AI to generate and give medical advice

## 6. MongoDB and Partner-Provided Resources

Whether you're here to build your first AI agent or level up your existing stack, this resource guide is your one-stop shop for everything you may need throughout the hackathon. From various MongoDB tools and workshops, to partner APIs, SDKs, and demo resources.

> Captured locally: see [`resources.md`](./resources.md) for the full link inventory, [`mongodb/`](./mongodb/) for MongoDB-authored deep summaries (including the pre-hackathon webinar series at [`mongodb/00-pre-hackathon-webinars/`](./mongodb/00-pre-hackathon-webinars/)), and [`aws/`](./aws/) for the AWS Free Tier guide.

## 7. Submission Process

Teams should submit at <https://cerebralvalley.ai/e/mongo-db-london-hackathon/hackathon/submit> when they have completed hacking. In the submission form, you will have to submit a short one minute demo video. This should be a video highlighting the specific features, code, and functionality that your team built during the hackathon.

**Please double check that your repository is public, your demo link is accessible, and all team members have been added to the submission page.**

## 8. Judging Process

> A self-evaluation version of this section, with checklists and scoring slots, lives separately at [`judging-criteria.md`](./judging-criteria.md). Use that one to score your project as you build.

First round judging will take place on **Saturday, May 2nd**. These judges are evaluating your **technical demos** in the following categories. *Show us what you have built* to solve our problem statements. Please **do not** show us a presentation. We'll be checking to ensure your project was built **entirely during the event**; no previous work is allowed.

Judging will be taking place on **Saturday, May 2nd** and **Thursday, May 7th** in **three** rounds. To be eligible for final judging and prizes, teams must participate in all three rounds **and ensure their project uses MongoDB Atlas as a core component**. Participation **requires that at least one team member attend MongoDB.local London** and promote their project as outlined below.

### First Round, MongoDB Agentic Evolution Hackathon General Vote, May 2nd, 2026

Hackers will be assigned to judging groups in different rooms of the venue. Each team will have approximately 3 minutes to live demo their project, followed by 1 to 2 minutes of Q&A.

The following criteria will be used:

- **Impact Potential (20%)**, what is the project's long-term potential for success? Will this project have a long-lasting impact on the industry, world, or any other areas? How useful and substantial is this project beyond the scope of the hackathon?
- **Live Demo (45%)**, how well has the team implemented their core idea? Does it work well live? How is it presented?
- **Creativity and Originality (35%)**, has this concept been seen before? In what ways does this project differentiate itself, and what innovations does it bring to its respective field? Does it tackle the problem statements in a unique way?

6 finalist teams will be selected ("**Finalists**"). The Finalists will demo to the hackathon attendees on stage after selection. *In the event that at least one team member from a Finalist is unable to attend MongoDB.local London, a backup team will be selected.*

### Second Round, MongoDB.local London Community Vote, May 7th, 2026

- The 6 Finalists will attend MongoDB.local, and each Finalist's demo will be displayed in Cerebral Valley's showcase area.
- MongoDB.local attendees will be provided the opportunity to vote for their favourite project at <https://cerebralvalley.ai/e/mongo-db-london-hackathon/hackathon/gallery>. **You will only be able to vote once.**
- The three Finalists that receive the greatest number of votes will proceed to the Final Round ("Final Three").

### Final Round, MongoDB.local London Mainstage Presentation, May 7th, 2026

- The Final Three will be notified at **2:00 PM** and invited to present their demo live on stage at MongoDB.local, in front of the VIP judging panel and audience.
- Finalists will have 3 minutes to present, with 2 minutes for Q&A.
- Judges will select the 1st, 2nd, and 3rd place winners based on the same criteria as above, though with equal weighting for each category.

### Best Use of ElevenLabs

The ElevenLabs bonus track will be judged separately and asynchronously, spanning all projects.

## 9. Prizes

**First Place:**

- £7.5k cash prize
- 1-Month Residency at London Founder House
- $3k LangSmith credits
- $5k Fireworks AI credits
- $3k Emergent credits
- 3-months ElevenLabs Pro tier per team member ($297 value/person)
- NVIDIA Jetson Orin Nanos
- NVIDIA RTX 5080

**Second Place:**

- £4.5k cash prize
- $2k LangSmith credits
- $3k Fireworks AI credits
- $2k Emergent credits

**Third Place:**

- £3k cash prize
- $1k LangSmith credits
- $2k Fireworks AI credits
- $1k Emergent credits

**Best Use of ElevenLabs:**

- 6 months of Scale tier per team member ($1980 value/person)

## Questions

If you have any questions, please email [blerta@cerebralvalley.ai](mailto:blerta@cerebralvalley.ai) or message on Discord.
