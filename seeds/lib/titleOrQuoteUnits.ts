// titleOrQuoteUnits — extract title-like and quoted-passage units from a
// filing's sentence stream. Pure TS. Ported from
// `src/datafetch/db/document_units.ts:titleOrQuoteUnits`.

import * as v from "valibot";

import { fn } from "../../src/sdk/index.js";

const FilingSchema = v.looseObject({
  id: v.optional(v.string()),
  preText: v.array(v.string()),
  postText: v.array(v.string()),
});

const InputSchema = v.object({
  filing: FilingSchema,
});

type Input = v.InferOutput<typeof InputSchema>;

const UnitSchema = v.object({
  id: v.string(),
  kind: v.literal("title_or_quote"),
  text: v.string(),
  source: v.union([v.literal("preText"), v.literal("postText")]),
  index: v.number(),
});

const OutputSchema = v.object({
  units: v.array(UnitSchema),
});

type Output = v.InferOutput<typeof OutputSchema>;
type Unit = v.InferOutput<typeof UnitSchema>;

function cleanText(value: string): string {
  return value
    .replace(/201c|201d/g, '"')
    .replace(/2019/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text: string): string[] {
  return cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

type Sentence = {
  id: string;
  text: string;
  source: "preText" | "postText";
  index: number;
};

function sentencesFor(
  filingId: string,
  source: "preText" | "postText",
  paragraphs: string[],
): Sentence[] {
  return paragraphs.flatMap((paragraph, paragraphIndex) =>
    splitSentences(paragraph).map((sentence, sentenceIndex) => ({
      id: `${filingId}:${source}:${paragraphIndex}:${sentenceIndex}`,
      text: sentence,
      source,
      index: paragraphIndex * 1000 + sentenceIndex,
    })),
  );
}

function quoteUnits(sentences: Sentence[]): Unit[] {
  const quoted: Unit[] = [];
  for (const unit of sentences) {
    const matches = unit.text.matchAll(/"([^"]{3,160})"/g);
    for (const [matchIndex, match] of Array.from(matches).entries()) {
      quoted.push({
        id: `${unit.id}:quote:${matchIndex}`,
        kind: "title_or_quote",
        text: match[1] ?? "",
        source: unit.source,
        index: unit.index,
      });
    }
  }
  return quoted;
}

function headingLikeUnits(sentences: Sentence[]): Unit[] {
  return sentences
    .filter((unit) => {
      const lower = unit.text.toLowerCase();
      return (
        lower.startsWith("competition ") ||
        lower.includes("emerging players") ||
        lower.includes("substantial and intense competition") ||
        lower.includes("local regulation")
      );
    })
    .map((unit) => ({
      id: `${unit.id}:heading`,
      kind: "title_or_quote" as const,
      text: unit.text,
      source: unit.source,
      index: unit.index,
    }));
}

export const titleOrQuoteUnits = fn<Input, Output>({
  intent:
    "extract title-like or quoted-passage text units from a filing's preText and postText sentences",
  examples: [
    {
      input: {
        filing: {
          id: "doc-1",
          preText: [
            'The CEO described the period as a "transformational year" for the firm.',
          ],
          postText: [],
        },
      },
      output: {
        units: [
          {
            id: "doc-1:preText:0:0:quote:0",
            kind: "title_or_quote",
            text: "transformational year",
            source: "preText",
            index: 0,
          },
        ],
      },
    },
  ],
  input: InputSchema,
  output: OutputSchema,
  body: ({ filing }: Input) => {
    const filingId = filing.id ?? "filing";
    const sentences = [
      ...sentencesFor(filingId, "preText", filing.preText),
      ...sentencesFor(filingId, "postText", filing.postText),
    ];
    const combined = [...quoteUnits(sentences), ...headingLikeUnits(sentences)];
    const seen = new Set<string>();
    const dedup = combined.filter((unit) => {
      const key = unit.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { units: dedup };
  },
});
