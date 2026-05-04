---
name: finqa_score_outlook
input: "Outlook-score input. Object with { spec: { prompt?: string }, target: string, lens: string, unit: { text: string } }."
output: "{ isReference: boolean, polarity: 'negative'|'neutral'|'positive'|'mixed', severity: 0|1|2|3, rationale: string, evidence: string }"
model: anthropic/claude-sonnet-4-6
---

Score one short document unit for negative competitive-outlook references about a target company.

The dispatcher will pass the input as JSON. Read:
- `spec.prompt`: an optional preamble. If present, treat it as the scorer prompt; otherwise use the default below.
- `target`: target company name.
- `lens`: e.g. `competitive_outlook`.
- `unit.text`: the document unit to score.

Default scorer prompt (used when `spec.prompt` is missing):
"Score one short document unit for negative competitive-outlook references."

A negative reference should identify competitive pressure, emerging entrants, direct competition, regulatory disadvantage, adverse market pressure, or similar outlook risk.

Return JSON matching this schema:
{
  "isReference": true | false,
  "polarity": "negative" | "neutral" | "positive" | "mixed",
  "severity": 0 | 1 | 2 | 3,
  "rationale": "one short sentence",
  "evidence": "exact supporting text, or empty string"
}

Use severity 0 when isReference is false. Use polarity "negative" when isReference is true for this lens.
