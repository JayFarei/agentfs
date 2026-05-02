import type { FinqaCase } from "../../finqa/types.js";

export type DocumentUnitKind = "sentence" | "title_or_quote";

export type DocumentUnit = {
  id: string;
  kind: DocumentUnitKind;
  text: string;
  source: "preText" | "postText";
  index: number;
};

export type DocumentUnitsPrimitive = {
  documentText(filing: FinqaCase): string;
  sentences(filing: FinqaCase): DocumentUnit[];
  titleOrQuoteUnits(filing: FinqaCase): DocumentUnit[];
};

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

function sentenceUnits(filing: FinqaCase, source: "preText" | "postText", paragraphs: string[]): DocumentUnit[] {
  return paragraphs.flatMap((paragraph, paragraphIndex) =>
    splitSentences(paragraph).map((sentence, sentenceIndex) => ({
      id: `${filing.id}:${source}:${paragraphIndex}:${sentenceIndex}`,
      kind: "sentence" as const,
      text: sentence,
      source,
      index: paragraphIndex * 1000 + sentenceIndex
    }))
  );
}

function quoteUnits(units: DocumentUnit[]): DocumentUnit[] {
  const quoted: DocumentUnit[] = [];
  for (const unit of units) {
    const matches = unit.text.matchAll(/"([^"]{3,160})"/g);
    for (const [matchIndex, match] of Array.from(matches).entries()) {
      quoted.push({
        id: `${unit.id}:quote:${matchIndex}`,
        kind: "title_or_quote",
        text: match[1],
        source: unit.source,
        index: unit.index
      });
    }
  }
  return quoted;
}

function headingLikeUnits(units: DocumentUnit[]): DocumentUnit[] {
  return units
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
      ...unit,
      id: `${unit.id}:heading`,
      kind: "title_or_quote" as const
    }));
}

export const document_units: DocumentUnitsPrimitive = {
  documentText(filing) {
    return [...filing.preText, ...filing.postText].map(cleanText).join("\n");
  },

  sentences(filing) {
    return [
      ...sentenceUnits(filing, "preText", filing.preText),
      ...sentenceUnits(filing, "postText", filing.postText)
    ];
  },

  titleOrQuoteUnits(filing) {
    const sentences = this.sentences(filing);
    const combined = [...quoteUnits(sentences), ...headingLikeUnits(sentences)];
    const seen = new Set<string>();
    return combined.filter((unit) => {
      const key = unit.text.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
};
