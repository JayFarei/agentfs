export type RawFinqaRecord = {
  id: string;
  filename: string;
  pre_text?: string[];
  post_text?: string[];
  table: string[][];
  qa: {
    question: string;
    answer?: string;
    program?: string;
    exe_ans?: number;
  };
};

export type FinqaCell = {
  column: string;
  columnKey: string;
  raw: string;
  value: number | null;
};

export type FinqaRow = {
  index: number;
  label: string;
  labelKey: string;
  cells: FinqaCell[];
};

export type FinqaCase = {
  id: string;
  filename: string;
  question: string;
  answer?: string;
  program?: string;
  preText: string[];
  postText: string[];
  table: {
    headers: string[];
    headerKeys: string[];
    rows: FinqaRow[];
  };
  searchableText: string;
};

export type FinqaSearchUnit = {
  caseId: string;
  filename: string;
  kind: "question" | "text" | "table_row";
  text: string;
  rowIndex?: number;
};

export type LocatedFigure = {
  rowLabel: string;
  rowKey: string;
  column: string;
  columnKey: string;
  raw: string;
  value: number;
  evidence: {
    caseId: string;
    filename: string;
    rowIndex: number;
  };
};

export type AnswerResult = {
  answer: number;
  roundedAnswer: number;
  evidence: LocatedFigure[];
};
