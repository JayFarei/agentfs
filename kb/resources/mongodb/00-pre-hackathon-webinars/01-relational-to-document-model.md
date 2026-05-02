---
title: "Webinar 1, Relational to Document Model"
source_video: https://www.youtube.com/live/Q_lnTtPzGAA
source_page: https://www.mongodb.com/resources/products/capabilities/webinar-relational-document-model
type: video + curated page
duration: "57:52"
speaker: "Aaron Becker (Curriculum Engineer, MongoDB University), Oscar in Q&A chat"
upload_date: 2025-12-15
channel: "MongoDB (YouTube)"
captured: 2026-05-01
---

## TL;DR

How to translate SQL/relational thinking into MongoDB's document model. Covers polymorphic collections, optional schema validation, embed-vs-reference decisions, and modeling relationships (1:1, 1:many, 1:few, 1:zillions) against your read/write workload. Foundational, ~58 min.

## Key Takeaways

- The document model lets data take the shape of your application code, removing the object-relational impedance mismatch
- A single MongoDB collection can hold documents with different fields (polymorphism), e.g. print books and ebooks in one `books` collection without nullable columns
- Schema validation is **optional** in MongoDB. Recommended workflow: prototype freely, then lock down rules once your workload is understood
- Cardinality drives modeling: 1:few → embed, 1:zillions → reference. Unbounded arrays are an antipattern
- Document hard limit is 16MB but you should aim to keep them lean, especially in read-heavy workloads
- A workload analysis (counts of each operation type, weighted by intensity) should precede schema choices

## What's Covered

### 1. Relational mapping mental model
SQL row → BSON document. Table → collection. Join → either embed (data colocated in one document) or reference (separate collection + lookup). The pitch: model around how the application queries, not around normal forms.

### 2. Polymorphism inside a single collection
Demonstrated with a bookstore: `books` holds both print and ebook documents in the same collection. Only ebook docs carry `supportedDevices`. No NULL columns, no separate tables. Queries that don't care about format Just Work; queries that do filter by the discriminator field.

### 3. Schema validation
Optional database-layer rules for required fields, types, value constraints. Works with polymorphic collections and embedded subdocuments. Recommended workflow:
1. Prototype with no validation
2. Observe how the application reads and writes
3. Lock down rules to keep data consistent at the database layer (independent of which client writes)

### 4. Embed vs reference, decision rules
**Embed when:** data is accessed together, the relationship is 1:1 or 1:few, the embedded set won't grow unbounded.
**Reference when:** the related entity needs independent queryability, the relationship is 1:many or 1:zillions, embedding would risk crossing the 16MB doc limit or destroy read performance.

### 5. Relationship cardinality, four cases
- **1:1**, e.g. publisher → headquarters
- **1:many**, e.g. book → reviews
- **1:few**, e.g. book → genres (~3-5). Always embed.
- **1:zillions**, e.g. best-selling book → readers. Always reference. Embedding would create an unbounded array, an antipattern that risks the 16MB doc limit and degrades reads.

### 6. Workload-driven schema design
Walks through a sample bookstore app's operation rates (e.g., fetch book details N/sec, write reviews K/sec, update stock M/sec). Arrives at "read-heavy" only after weighting frequency by intensity, not by raw operation count. Then selects schema patterns accordingly.

### 7. Skill badge
Companion 10-question check at `mdb.link/docroad2sf`. Pass to earn the Relational to Document Model badge on LinkedIn.

## When to dive into the source

- New to MongoDB from SQL and want the canonical mental model in one sitting
- Modeling a new collection and stuck on embed vs reference
- Need to explain to a relational-mindset teammate why nullable columns "don't apply" in MongoDB
- **Skip if:** you've already shipped a production MongoDB app, content is intro-level

## Source

- Video: <https://www.youtube.com/live/Q_lnTtPzGAA>
- Resource page: <https://www.mongodb.com/resources/products/capabilities/webinar-relational-document-model>
- Skill check: `mdb.link/docroad2sf` (per transcript)
- MongoDB Skills hub: <https://learn.mongodb.com/skills>
