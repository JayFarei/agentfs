---
title: "Get Started with the Java Sync Driver: Install, Connect, Run a Query"
source: https://www.mongodb.com/developer/languages/java/java-setup-crud-operations
type: tutorial
captured: 2026-05-01
---

## TL;DR

The official walkthrough for installing the synchronous MongoDB Java driver via Maven or Gradle BOM, creating a free Atlas cluster, building a connection string, and running a first query against the `sample_mflix.movies` collection. The minimum-viable Java + MongoDB onboarding.

## Key Takeaways

- Driver installed via Maven or Gradle, with the MongoDB JVM Bill of Materials (`mongodb-driver-bom` version 5.6.5) managing version pinning.
- Sync driver artifact: `org.mongodb:mongodb-driver-sync` (no version when BOM is used).
- Requires JDK 8 or later, but a TLS 1.3 issue exists on older JDK patch versions, fixed in JDK 11.0.7, 13.0.3, 14.0.2, or newer.
- Sample query targets the `sample_mflix` database and `movies` collection, both populated when you load Atlas sample data.
- Connection happens through `MongoClients.create(uri)` returning a `MongoClient`, used in a try-with-resources block.
- Filters built with `com.mongodb.client.model.Filters.eq` plus a `Document` from `org.bson`.

## What's Covered

### 1. Install the driver dependencies

Install JDK 8+ and an IDE (IntelliJ or Eclipse). The tutorial uses Maven or Gradle in an IDE, but links out to instructions for non-IDE setups.

### 2. Add the BOM

Maven `pom.xml` `dependencyManagement`:

```xml
<dependency>
  <groupId>org.mongodb</groupId>
  <artifactId>mongodb-driver-bom</artifactId>
  <version>5.6.5</version>
  <type>pom</type>
  <scope>import</scope>
</dependency>
```

Gradle Kotlin DSL: `implementation(platform("org.mongodb:mongodb-driver-bom:5.6.5"))`.

### 3. Install the sync driver

Maven adds `mongodb-driver-sync` with no version (the BOM controls it). Gradle adds `implementation("org.mongodb:mongodb-driver-sync")`. Refresh dependencies in the IDE.

### 4. Create a free Atlas deployment

Walks through Atlas signup, free-tier cluster creation, sample data loading (required for the next step), and IP access list configuration.

### 5. Get a connection string

Open the cluster's Connect dialog, choose Drivers, select Java and the matching version, deselect "View full code sample" to see only the URI, copy it, replace the `<db_password>` placeholder.

### 6. Run a sample query

Create `QuickStart.java`:

```java
import static com.mongodb.client.model.Filters.eq;
import org.bson.Document;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.MongoDatabase;

public class QuickStart {
  public static void main(String[] args) {
    String uri = "<connection string uri>";
    try (MongoClient mongoClient = MongoClients.create(uri)) {
      MongoDatabase database = mongoClient.getDatabase("sample_mflix");
      MongoCollection<Document> collection = database.getCollection("movies");
      Document doc = collection.find(eq("title", "Back to the Future")).first();
      System.out.println(doc != null ? doc.toJson() : "No matching documents found.");
    }
  }
}
```

Returns the BSON document for the matching movie.

### TLS 1.3 troubleshooting

If you see `SSLHandshakeException: extension (5) should not be presented in certificate_request`, your JDK predates the TLS 1.3 fix. Upgrade to JDK 11.0.7, 13.0.3, 14.0.2, or newer.

## When to dive into the source

- You have never connected a Java app to MongoDB and want a verified minimal example.
- You are setting up a new project and need the exact BOM coordinates and dependency syntax.
- Skip if: you already have a working Maven/Gradle MongoDB project (jump to ./java-quick-start.md or ./java-spring-boot-starter.md for the deeper feature catalog).

## Source

- Primary: https://www.mongodb.com/developer/languages/java/java-setup-crud-operations
- Related: https://www.mongodb.com/docs/drivers/java/sync/current/databases-collections/
- Related: https://www.mongodb.com/docs/drivers/java/sync/current/connection/mongoclient/
