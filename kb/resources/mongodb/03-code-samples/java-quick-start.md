---
title: "Java Quick Start: CRUD, POJOs, Aggregation, Change Streams, CSFLE, Transactions"
source: https://github.com/mongodb-developer/java-quick-start
type: github-repo
captured: 2026-05-01
---

## TL;DR

A Maven project containing standalone runnable classes for each major MongoDB Java driver feature: connection, CRUD, POJO mapping, aggregation, change streams, client-side field-level encryption, and multi-document ACID transactions. Each class is the artifact for a corresponding blog post in the Java Quick Start series.

## Key Takeaways

- Six tutorials' code in one repo: CRUD, POJOs, Aggregation Pipeline, Change Streams, Client-Side Field Level Encryption (CSFLE), and Multi-Doc ACID Transactions.
- Requirements: Java 21 and Maven 3.8.7.
- Each example runs via `mvn compile exec:java -Dexec.mainClass=...` with a `-Dmongodb.uri=...` system property.
- Classes live under `com.mongodb.quickstart`, with sub-packages for `csfle` and `transactions`.
- Transactions example has an ordering requirement: run `transactions.ChangeStreams` first to bootstrap the `product` collection with its JSON Schema before running `transactions.Transactions`.
- Maintained by Maxime Beugnet (MongoDB developer advocate).

## What's Covered

### Tutorials covered

| Class | Topic |
| --- | --- |
| `HelloMongoDB` | Smoke test, no DB |
| `Connection` | Connect to Atlas with a URI |
| `Create`, `Read`, `Update`, `Delete` | CRUD primitives |
| `MappingPOJO` | POJO codec mapping |
| `AggregationFramework` | Aggregation pipeline |
| `ChangeStreams` | Listen to changes |
| `csfle.ClientSideFieldLevelEncryption` | CSFLE |
| `transactions.ChangeStreams` and `transactions.Transactions` | Multi-doc ACID transactions |

### Build and run pattern

```
mvn clean compile
mvn compile exec:java -Dexec.mainClass="com.mongodb.quickstart.Connection" \
  -Dmongodb.uri="mongodb+srv://USERNAME:PASSWORD@cluster0-abcde.mongodb.net/test?w=majority"
```

The same shape works for every other class, swap the `-Dexec.mainClass` value.

### Transactions ordering trap

`transactions.ChangeStreams` creates the `product` collection with the JSON Schema required by `transactions.Transactions`. Running them in the wrong order means schema validation will fail. The README spells this out, easy to miss.

### POJOs and codecs

The `MappingPOJO` class shows how to register a POJO `CodecRegistry` so MongoDB documents map directly to Java classes without manual `Document` plumbing. This pattern carries over directly into the Spring Boot starter project.

## When to dive into the source

- You are writing a Java hackathon backend and need a known-good template for any of: connection setup, CRUD, aggregation, change streams, CSFLE, or transactions.
- You hit a behavior question about a specific driver feature and want a minimal runnable repro to compare against.
- Skip if: you are building a REST API and want the full Spring Boot starter (use ./java-spring-boot-starter.md), or you only need the absolute first-connection walkthrough (use ./java-crud-tutorial.md).

## Source

- Primary: https://github.com/mongodb-developer/java-quick-start
- Related: https://www.mongodb.com/developer/languages/java/java-setup-crud-operations/
- Related: https://www.mongodb.com/developer/languages/java/java-mapping-pojos/
