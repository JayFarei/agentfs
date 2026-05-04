// sentenceUnits — split a filing's preText/postText paragraphs into
// addressable sentence units. Pure TS. Ported from
// `src/datafetch/db/document_units.ts:sentences`.

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
  kind: v.literal("sentence"),
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

function sentenceUnitsFor(
  filingId: string,
  source: "preText" | "postText",
  paragraphs: string[],
): Unit[] {
  return paragraphs.flatMap((paragraph, paragraphIndex) =>
    splitSentences(paragraph).map((sentence, sentenceIndex) => ({
      id: `${filingId}:${source}:${paragraphIndex}:${sentenceIndex}`,
      kind: "sentence" as const,
      text: sentence,
      source,
      index: paragraphIndex * 1000 + sentenceIndex,
    })),
  );
}

export const sentenceUnits = fn<Input, Output>({
  intent:
    "split a filing's preText and postText paragraphs into addressable sentence units",
  examples: [
    {
      input: {
        filing: {
          id: "doc-1",
          preText: ["The company grew. It performed well."],
          postText: [],
        },
      },
      output: {
        units: [
          {
            id: "doc-1:preText:0:0",
            kind: "sentence",
            text: "The company grew.",
            source: "preText",
            index: 0,
          },
          {
            id: "doc-1:preText:0:1",
            kind: "sentence",
            text: "It performed well.",
            source: "preText",
            index: 1,
          },
        ],
      },
    },
  ],
  input: InputSchema,
  output: OutputSchema,
  body: ({ filing }: Input) => {
    const filingId = filing.id ?? "filing";
    return {
      units: [
        ...sentenceUnitsFor(filingId, "preText", filing.preText),
        ...sentenceUnitsFor(filingId, "postText", filing.postText),
      ],
    };
  },
});
