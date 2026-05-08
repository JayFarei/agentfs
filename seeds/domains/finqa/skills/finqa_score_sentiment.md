---
name: finqa_score_sentiment
input: "Sentiment-score input. Object with { spec: { prompt?: string }, question: string, documentText: string }."
output: "{ sentiment: 'positive'|'neutral'|'negative'|'mixed', confidence: number, rationale: string, evidence: string[] }"
model: anthropic/claude-sonnet-4-6
---

Classify the sentiment/tone of the document excerpt for the provided question.

The dispatcher will pass the input as JSON. Read:
- `spec.prompt`: an optional preamble. If present, treat it as the scorer prompt; otherwise use the default below.
- `question`: the user's framing question.
- `documentText`: the document excerpt (truncated to ~5000 chars).

Default scorer prompt (used when `spec.prompt` is missing):
"Classify the sentiment/tone of the document excerpt."

Return the typed result with concise evidence quotes from the excerpt, matching this schema:
{
  "sentiment": "positive" | "neutral" | "negative" | "mixed",
  "confidence": <number between 0 and 1>,
  "rationale": "one short sentence",
  "evidence": ["short quoted phrase from the excerpt", ...]
}
