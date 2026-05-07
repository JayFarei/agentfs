// `huggingFaceMount({dataset})` constructor — source descriptor for
// public Hugging Face datasets exposed through the Dataset Viewer API.

export type HuggingFaceSource = {
  kind: "huggingface";
  dataset: string;
  config?: string;
  split?: string;
  sourceUrl?: string;
  endpoint?: string;
};

export const huggingFaceMount = (args: {
  dataset: string;
  config?: string;
  split?: string;
  sourceUrl?: string;
  endpoint?: string;
}): HuggingFaceSource => ({
  kind: "huggingface",
  dataset: args.dataset,
  ...(args.config !== undefined ? { config: args.config } : {}),
  ...(args.split !== undefined ? { split: args.split } : {}),
  ...(args.sourceUrl !== undefined ? { sourceUrl: args.sourceUrl } : {}),
  ...(args.endpoint !== undefined ? { endpoint: args.endpoint } : {}),
});
