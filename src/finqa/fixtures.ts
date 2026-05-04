import type { RawFinqaRecord } from "./types.js";

const visaPaymentVolume: RawFinqaRecord = {
  id: "fixture-v-2008-page-17",
  filename: "V/2008/page_17.pdf",
  pre_text: [
    "The following table summarizes selected payments volume and transaction metrics for major payment networks."
  ],
  post_text: [
    "Payments volume is presented in billions and total transactions are presented in billions."
  ],
  table: [
    ["Network", "Payments volume (billions)", "Total transactions (billions)"],
    ["american express", "637", "5"],
    ["jcb", "55", "0.6"],
    ["diners club", "145", "1"],
    ["Visa Inc. ( 1 )", "2000", "20"]
  ],
  qa: {
    question: "what is the average payment volume per transaction for american express?",
    answer: "127.4",
    program: "divide(637, 5)",
    exe_ans: 127.4
  }
};

const unionPacificRevenue: RawFinqaRecord = {
  id: "fixture-unp-2016-page-52",
  filename: "UNP/2016/page_52.pdf",
  pre_text: [
    "Union Pacific operating revenue by commodity group, dollars in millions."
  ],
  post_text: [
    "The table includes total operating revenues and total freight revenues for share calculations."
  ],
  table: [
    ["Commodity group", "2016", "2015", "2014"],
    ["chemicals", "1623", "1750", "1813"],
    ["coal", "2628", "3400", "4315"],
    ["agricultural products", "3625", "3300", "3400"],
    ["automotive", "2100", "2200", "2300"],
    ["intermodal", "3900", "3700", "3600"],
    ["industrial products", "2800", "2900", "3100"],
    ["total freight revenues", "16676", "17250", "18328"],
    ["total operating revenues", "19941", "20100", "20500"]
  ],
  qa: {
    question: "what portion of revenue came from agricultural products?",
    answer: "18.18%",
    program: "divide(3625, 19941)",
    exe_ans: 18.178626949501027
  }
};

const visaCompetitiveOutlook: RawFinqaRecord = {
  id: "fixture-v-2012-page-28",
  filename: "V/2012/page_28.pdf",
  pre_text: [
    "Visa is the largest retail electronic payments network in the world.",
    "Competition from global payment networks remains a risk.",
    "New entrants compete directly with Visa in several regions.",
    "Several competitors pressure merchant pricing.",
    "Some competitive networks pursue lower-cost routing.",
    "This document discusses Visa competitive positioning, negative competitive outlook references, evidence sentences, titles and quotes."
  ],
  post_text: [
    "Visa is also one of the largest operators of open-loop and closed-loop retail electronic payments networks."
  ],
  table: [
    ["Metric", "2012"],
    ["Accounts", "1000"]
  ],
  qa: {
    question: "what is the sentiment of Visa's competitive positioning in this document?",
    answer: "positive",
    program: "classify_sentiment(document)",
    exe_ans: 1
  }
};

export const fixtureFinqaDatasets: Record<string, RawFinqaRecord[]> = {
  dev: [visaPaymentVolume],
  private_test: [unionPacificRevenue],
  train: [visaCompetitiveOutlook],
  test: []
};
