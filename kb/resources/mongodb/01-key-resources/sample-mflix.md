---
title: "Sample Mflix Dataset - Atlas"
source: https://www.mongodb.com/docs/atlas/sample-data/sample-mflix
type: documentation
captured: 2026-05-01
---

## TL;DR

The `sample_mflix` Atlas sample database is a movies/theaters/users/comments dataset that ships with pre-computed plot embeddings, making it the fastest way to prototype search, vector search, and aggregation pipelines without bringing your own data.

## Key Takeaways

- Six collections: `movies`, `embedded_movies`, `comments`, `theaters`, `users`, `sessions`. Loaded via the Atlas UI's "Load Sample Data" action.
- `embedded_movies` (Western, Action, Fantasy genres only) ships with two pre-computed embedding fields: `plot_embedding` (1536d, OpenAI `text-embedding-ada-002`) and `plot_embedding_voyage_3_large` (2048d, Voyage AI `voyage-3-large`), both stored as `binData` for compact storage.
- `movies` has a sparse text index over `cast`, `fullplot`, `genres`, `title` (named `cast_text_fullplot_text_genres_text_title_text`), useful for `$text` search demos before reaching for Atlas Search.
- `theaters` carries a `2dsphere` geospatial index on `location.geo` (GeoJSON Point), so geo-near demos work out of the box.
- `users.email` is unique, `sessions.user_id` is unique. Useful when demoing constraints or auth-style flows.
- `comments` has only the default `_id` index, with `name`, `email`, `movie_id`, `text`, `date`. A natural target for joins back to `movies` via `$lookup`.

## What's Covered

### Collection inventory and use

`movies` is the broad catalog (title, year, cast, directors, plot, fullplot, imdb, tomatoes, awards, countries, genres, num_mflix_comments). `embedded_movies` is a filtered slice carrying the embedding fields. `comments` references movies by `movie_id`. `theaters` carries address plus GeoJSON. `users` holds bcrypt-hashed passwords. `sessions` carries JWTs keyed by `user_id`.

### Embedded movies and vector search

The `embedded_movies` collection is the canonical playground for Atlas Vector Search. Two embedding columns let you compare provider/dimensionality tradeoffs side by side without re-embedding. Both are stored as BSON `binData` (more compact and faster than arrays of doubles). Sample documents in the docs truncate dimension counts for readability.

### Indexes you get for free

- `movies`: `_id_`, plus a sparse text index covering `cast`, `fullplot`, `genres`, `title`.
- `theaters`: `_id_`, plus a sparse `2dsphere` index on `location.geo`.
- `users`: `_id_`, plus unique index on `email`.
- `sessions`: `_id_`, plus unique index on `user_id`.
- `comments` and `embedded_movies` only have `_id_`. You will add your own search/vector indexes.

### Sample document shapes

`movies` documents look like:

```json
{ "_id": ObjectId("..."), "title": "The Arrival of a Train", "year": 1896,
  "plot": "...", "fullplot": "...", "directors": ["Auguste Lumière", "Louis Lumière"],
  "imdb": { "rating": 7.3, "votes": 5043, "id": 12 },
  "cast": ["Madeleine Koehler"], "countries": ["France"],
  "genres": ["Documentary", "Short"],
  "tomatoes": { "viewer": { "rating": 3.7, "numReviews": 59 }, "lastUpdated": ISODate(...) },
  "num_mflix_comments": 1 }
```

`comments` link to movies by `movie_id` (an `ObjectId` matching `movies._id`).

## When to dive into the source

- You need the exact field list for a collection before writing a query or building a search index.
- You are deciding between the OpenAI 1536d and Voyage 2048d embedding for a vector-search demo and want the full doc.
- You want the `theaters` GeoJSON shape for a geo-near demo.
- Skip if: you already know the collections and just want to load the data; the Atlas UI's "Load Sample Data" button is enough.

## Source

- Primary: https://www.mongodb.com/docs/atlas/sample-data/sample-mflix
- Related: https://www.mongodb.com/docs/atlas/sample-data/load-sample-data/ (loader instructions), https://www.mongodb.com/docs/manual/core/index-text/ (text index reference), https://www.mongodb.com/docs/manual/reference/geojson/ (GeoJSON shapes)
