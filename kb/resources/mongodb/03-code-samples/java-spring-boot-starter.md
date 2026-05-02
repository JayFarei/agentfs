---
title: "Java + Spring Boot + MongoDB REST API Starter"
source: https://github.com/mongodb-developer/java-spring-boot-mongodb-starter
type: github-repo
captured: 2026-05-01
---

## TL;DR

A production-shaped Spring Boot 3.2.2 + MongoDB 7.0 REST API template with Swagger UI, OpenAPI 3, virtual threads, multi-document transactions, aggregation, and POJO codec mapping already wired in. The most batteries-included Java hackathon starter MongoDB publishes.

## Key Takeaways

- Pinned versions: Java 21, Spring Boot 3.2.2, MongoDB 7.0, MongoDB Java driver 4.11.1, Maven 3.8.7, OpenAPI 3.
- Configure with either `spring.data.mongodb.uri` in `application.properties` or a `MONGODB_URI` environment variable.
- Run with `mvn spring-boot:run`. Build a fat jar with `mvn clean package` then `java -jar target/java-spring-boot-mongodb-starter-1.0.0.jar`.
- Virtual threads are enabled with one line: `spring.threads.virtual.enabled=true` in `application.properties`.
- Swagger UI is at `/swagger-ui/index.html`, OpenAPI 3.0.1 JSON at `/v3/api-docs`, YAML at `/v3/api-docs.yaml`, no extra config needed thanks to `springdoc-openapi-starter-webmvc-ui`.
- Showcases ACID multi-document transactions (`MongoDBPersonRepository.saveAll()`), aggregation (`getAverageAge()`), CRUD, POJO mapping via codecs (`ConfigurationSpring.java`), and ObjectId handling across REST/POJO/DB boundaries (`Person.java`).

## What's Covered

### Stack and versions

| Component | Version |
| --- | --- |
| Java | 21 |
| Spring Boot | 3.2.2 |
| MongoDB server | 7.0 |
| MongoDB Java driver | 4.11.1 |
| Maven | 3.8.7 |
| OpenAPI | 3 |

### Build and run

```
mvn spring-boot:run                 # dev
mvn clean test                      # unit tests
mvn clean integration-test          # e2e tests
mvn clean package                   # fat jar
java -jar target/java-spring-boot-mongodb-starter-1.0.0.jar
```

### Virtual threads

Enabled by JDK 21 plus Spring 3.2.0+ plus the property `spring.threads.virtual.enabled=true`. No code changes required.

### Feature showcase

- ACID transactions across three functions, see `MongoDBPersonRepository.saveAll()`.
- Aggregation pipeline, see `MongoDBPersonRepository.getAverageAge()`.
- CRUD baseline in `MongoDBPersonRepository.java`.
- POJO mapping via the codec registry in `ConfigurationSpring.java`, no Spring Data MongoDB required.
- ObjectId conversion across REST DTO, POJO, and BSON boundaries handled in `Person.java`.

### Editorial note from the README

The author argues you do not have to use Spring Data MongoDB; the raw MongoDB driver, combined with codecs, gives you everything you need with more flexibility and tighter query control.

### Sample API call

```
curl -X POST http://localhost:8080/api/person \
  -H 'accept: */*' -H 'Content-Type: application/json' \
  -d '{"firstName":"Maxime","lastName":"Beugnet","age":35, ...}'
```

## When to dive into the source

- You are building a Java REST API for a hackathon and want Swagger, transactions, virtual threads, and ObjectId handling already solved.
- You want a worked example of using the raw MongoDB Java driver with POJO codecs instead of Spring Data MongoDB.
- Skip if: you only need the first-connection Java tutorial (use ./java-crud-tutorial.md), or your stack is JavaScript/Python (use ./mern-stack-example.md or ./genai-showcase.md).

## Source

- Primary: https://github.com/mongodb-developer/java-spring-boot-mongodb-starter
- Related: https://www.mongodb.com/developer/code-examples/java/rest-apis-java-spring-boot/ (companion blog post)
- Related: ./java-quick-start.md (lower-level driver examples)
