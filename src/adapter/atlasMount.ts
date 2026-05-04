// `atlasMount({uri, db})` constructor — the provider's source descriptor.
//
// Per `kb/prd/personas.md` §1's mock:
//
//   const finqa = await datafetch.publishMount({
//     id: "finqa-2024",
//     source: atlasMount({ uri: process.env.ATLAS_URI!, db: "finqa" }),
//     warmup: "lazy",
//   });
//
// Returns a tagged source descriptor that `publishMount` discriminates on
// to construct the right MountAdapter.

export type AtlasSource = {
  kind: "atlas";
  uri: string;
  db: string;
};

export const atlasMount = (args: { uri: string; db: string }): AtlasSource => ({
  kind: "atlas",
  uri: args.uri,
  db: args.db,
});
