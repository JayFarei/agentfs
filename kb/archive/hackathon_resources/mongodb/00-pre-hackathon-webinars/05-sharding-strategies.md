---
title: "Webinar 5, Sharding Strategies"
source_video: https://www.youtube.com/watch?v=_YPcqVwOJs4
source_page: https://www.mongodb.com/resources/products/capabilities/webinar-sharding-strategies
type: video + curated page
duration: "59:30"
speaker: "Aaron Becker (Curriculum Engineer, MongoDB University), Peter in Q&A chat"
upload_date: 2026-01-14
channel: "MongoDB (YouTube)"
captured: 2026-05-01
---

## TL;DR

How to design and run a sharded MongoDB cluster without creating hot shards. Covers Atlas vs self-managed setup, range vs hashed sharding, the four criteria for picking a shard key (cardinality, frequency, monotonic, write distribution), and how to refine a shard key if your first choice is wrong. Demoed on a fictional online bank, "Leafy Bank." ~60 min.

## Key Takeaways

- Sharding is a "living architecture", once enabled, the balancer continuously redistributes chunks across shards behind the scenes
- The shard key is **the single most important decision** in your DB's lifecycle. Get it right; refining later is possible but disruptive
- Two strategies:
  - **Ranged sharding** (default): efficient range queries; vulnerable to hotspots if the key is monotonically increasing (e.g. timestamps)
  - **Hashed sharding**: even insert distribution; destroys range-query efficiency
- Four shard-key criteria to evaluate: high **cardinality**, low **frequency** (no values that dominate), **non-monotonic**, evenly distributed **read/write traffic**
- A matching index on the shard key is required to shard a non-empty collection
- The Atlas dashboard exposes shard-key metrics: % updates to shard key (want low), % multi-writes without shard key (want zero, otherwise scatter-gather), distribution skew across shards
- Zone sharding pins data to specific physical shards for latency and regulatory-compliance reasons

## What's Covered

### 1. Why shard at all
Vertical scaling hits limits (single-machine RAM, CPU, IOPS). Sharding splits the dataset across shards so reads and writes hit different physical nodes. The session calls out that you should shard to relieve a real bottleneck, not preemptively.

### 2. Atlas vs self-managed setup
- **Atlas managed**: choose number of shards, shard key, and Atlas handles infra (config servers, replica sets, balancer config). Recommended path for the hackathon.
- **Self-managed**: full control, you provision shards, config servers, mongos routers, balancer manually. Used when you need to customize beyond what Atlas exposes.

### 3. The Leafy Bank demo
Fictional online bank used throughout: starts with thousands of users, grows to millions, hits scaling pain on the `messages` collection (alerts/notifications), and the team takes the role of a "Database Platform Engineer" deciding how to shard.

### 4. Ranged sharding
Default strategy. Documents grouped by shard-key ranges (e.g., `region: 1, ride_id: 1` shards rides by region). Range queries are fast (target one shard). Vulnerable to hotspots if data piles up at one end of the range, especially with monotonically increasing keys.

### 5. Hashed sharding
Hashes the shard key before placing the document. Inserts spread evenly across shards regardless of key skew. Trade-off: range queries become scatter-gather (must hit all shards) because adjacent values no longer live together. Use when the natural key is monotonic and you can't change it.

### 6. The four criteria for shard-key selection
- **Cardinality**, how many distinct values? Low cardinality → too few possible chunks → can't spread the load
- **Frequency**, are some values vastly more common than others? High frequency on a few values → those shards become hot
- **Monotonicity**, does the value strictly increase or decrease over time (timestamps, ObjectIds)? Yes → all new inserts hit the same shard
- **Read/write distribution**, are operations evenly spread across the key range? If 90% of reads target one decade of timestamps, that's a hotspot

For Leafy Bank's `messages`, `user_id` scores well on all four → chosen as the shard key.

### 7. Reading the Atlas shard-key metrics
The dashboard exposes:
- **% shard-key updates**: 1% is good, frequent shard-key changes mean metadata churn on config servers
- **% multi-writes without shard key**: 0 is ideal, otherwise queries fan out to all shards (scatter-gather)
- **% single-writes without shard key**: same, want 0
- **Per-shard data distribution**: even is good, skewed means a hot shard

### 8. Sharding a non-empty collection
You must create a matching index on the shard key first. The session walks through the actual Atlas UI clicks: enable sharding on the cluster, create the index, then `shardCollection`.

### 9. Zone sharding
Tag shards (e.g., `eu`, `us-west`) and route documents whose shard key matches a zone tag to those specific shards. Used for latency (data near the user) and compliance (GDPR-style data residency).

### 10. Refining a shard key
The session ran out of time but flagged: refine when the original key has become a hotspot. There's a process, not always trivial.

### 11. Skill badge
Companion check at `mdb.link/sharting-sf` (sic). Earns the MongoDB Sharding Strategies badge.

## When to dive into the source

- You're planning a deployment that will need to shard within 12 months
- You inherited a sharded cluster with a hot shard and need to diagnose
- You're choosing between range and hashed for a specific workload
- **Skip if:** your hackathon project will fit in a single Atlas cluster (most will). Save sharding for the post-hackathon scale conversation.

## Source

- Video: <https://www.youtube.com/watch?v=_YPcqVwOJs4>
- Resource page: <https://www.mongodb.com/resources/products/capabilities/webinar-sharding-strategies>
- Skill check: `mdb.link/sharting-sf` (per transcript)
- MongoDB sharding docs: <https://www.mongodb.com/docs/manual/sharding/>
- Shard-key selection guide: <https://www.mongodb.com/docs/manual/core/sharding-choose-a-shard-key/>
