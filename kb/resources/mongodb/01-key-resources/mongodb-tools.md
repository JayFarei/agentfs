---
title: "Download MongoDB Command Line Database Tools"
source: https://www.mongodb.com/try/download/database-tools
type: documentation
captured: 2026-05-01
---

## TL;DR

Index page for every official MongoDB client/utility you might need during a hackathon: the shell, the GUI, the Atlas CLI, import/export and migration tools, the VS Code extension, and infra integrations (Terraform, Kubernetes operator).

## Key Takeaways

- `mongosh` is the modern shell with autocomplete, syntax highlighting, contextual help. Apache 2.0, released independently from the server.
- MongoDB Compass is the GUI: schema visualization, query builder, real-time perf metrics. Three editions: full, Readonly (no writes/deletes), Isolated (only the DB connection, useful for restricted environments).
- Atlas CLI (`mongodb-atlas`) is the unified CLI for cluster management, including creating Atlas Search and Vector Search indexes from the terminal.
- Database Tools (`mongodump`, `mongorestore`, `mongoimport`, `mongoexport`, etc.) ship on a release schedule independent from the server, so you can pick up new features without upgrading the cluster.
- `mongosync` migrates data between clusters (Atlas, on-prem, other clouds). It is compatible only with major MongoDB versions, see its server compat matrix.
- Relational Migrator imports from Oracle, SQL Server, MySQL, PostgreSQL, Sybase, IBM DB2 into Atlas or self-managed MongoDB.
- VS Code extension lets you connect, browse, prototype CRUD, and access `mongosh` inside the editor. Works with Atlas and self-managed.
- Infra: Atlas Terraform Provider for IaC, Atlas Kubernetes Operator to manage Atlas from a k8s control plane.

## What's Covered

### Local developer tooling

`mongosh` for command-line work, Compass for visual exploration, the VS Code extension for in-editor browsing and CRUD prototyping. Compass has the three-edition split if you need to hand a tool to someone who should not delete data.

### Atlas management

Atlas CLI handles deployments, users, network access, and crucially Search and Vector Search index creation from the terminal. Pairs with the Atlas Terraform provider when you want infrastructure as code, or the Atlas Kubernetes Operator when Atlas resources should live in a k8s manifest.

### Data movement

`mongosync` for cluster-to-cluster sync (and live migration into Atlas via the related Atlas Live Migrate flow). Database Tools (`mongodump`/`mongorestore` for BSON, `mongoimport`/`mongoexport` for JSON/CSV/TSV) for backups and ad hoc moves. Relational Migrator for the SQL-to-document jump.

### Specialized utilities

BI Connector exposes MongoDB to SQL-speaking BI tools (Tableau, Power BI) and ships with Enterprise Advanced. App Services CLI and the legacy MongoDB CLI for Cloud/Ops Manager round out the operations toolkit.

### Licensing notes

Several tools are open source under Apache 2.0 and released independently from the server, including `mongosh` and the Database Tools. The BI Connector requires Enterprise Advanced.

## When to dive into the source

- You need a download link for a specific OS/arch combo.
- You are weighing Compass full vs Readonly vs Isolated for a regulated environment.
- You want to confirm `mongosync` supports your source/target server versions.
- Skip if: you only need `mongosh` and Compass and have already installed them. The page is mostly a directory.

## Source

- Primary: https://www.mongodb.com/try/download/database-tools
- Related: https://www.mongodb.com/docs/database-tools/, https://www.mongodb.com/docs/atlas/cli/, https://www.mongodb.com/docs/compass/
