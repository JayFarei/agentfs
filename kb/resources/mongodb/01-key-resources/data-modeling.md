---
title: "Data Modeling in MongoDB - Database Manual"
source: https://www.mongodb.com/docs/manual/data-modeling/
type: documentation
captured: 2026-05-01
---

## TL;DR

Entry-point doc for MongoDB schema design. The single most important principle: data accessed together should be stored together. Reach for this when you are deciding embed-vs-reference for a relationship.

## Key Takeaways

- MongoDB collections are polymorphic: documents in one collection may differ in fields and field types. Schema validation is opt-in and per-field.
- Core principle: model around your application's read patterns, not around normalization rules. Embedding lets you avoid joins for hot reads.
- The doc explicitly names three relationship types and points to two linking strategies: embedding and referencing.
- Document field values can be any BSON type, including nested documents, arrays, and arrays of documents. This is what makes 1:N and N:N modelable inline.
- Schema flexibility is iterative. You can refine your model as the application evolves without an upfront migration like a relational table.
- The page is a hub: the substantive guidance lives in linked pages (best practices, embedding, referencing, schema design process).

## What's Covered

### Flexible schema, with optional rigor

Documents in the same collection are not required to have identical fields, and a given field can hold different types across documents. You can apply schema validation selectively where you need stricter control (for example, on a payment amount field) while leaving newer or sparser fields loose during iteration.

### Use case framing

Three illustrative examples in the doc: embed department info inside an `employee` document for one-query reads, store rarely-accessed product reviews in a separate collection from a hot product page, and store heterogeneous product catalog items in one collection despite divergent attribute sets.

### Modeling relationships

Three relationship types are called out: one-to-one (patient and medical record), one-to-many (user and posts), many-to-many (students and courses). Two linking strategies: embed (nest the related data) or reference (store an id and join with `$lookup`). Selection is driven by access patterns, write frequency, and document size.

### Relational vs document tradeoffs

The doc contrasts upfront fixed schemas in a relational DB against the iterative document model, and contrasts cross-table joins against embedded data that returns a complete view in one read. Useful framing if your team is new to document design.

### What is not on this page

This is a landing page. Concrete patterns (when to embed vs reference, document size limits, anti-patterns like unbounded arrays, schema versioning) live in the linked best-practices and schema-design-process pages.

## When to dive into the source

- You are about to commit a schema and want the canonical embed-vs-reference rationale.
- A reviewer asks why you denormalized something and you want a citation.
- Skip if: you already know your access patterns and just want sample-document shapes; go straight to the best practices page or to a domain-specific schema design tutorial.

## Source

- Primary: https://www.mongodb.com/docs/manual/data-modeling/
- Related: https://www.mongodb.com/docs/manual/data-modeling/best-practices/, https://www.mongodb.com/docs/manual/data-modeling/embedding/, https://www.mongodb.com/docs/manual/data-modeling/referencing/
