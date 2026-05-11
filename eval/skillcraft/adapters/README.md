# Adapter Contracts

The full SkillCraft benchmark needs three bridges before the `datafetch-learned`
arm can be treated as faithful:

1. Fixture importer: mirror real SkillCraft task directories.
2. Tool bridge: expose declared SkillCraft local tools to Datafetch snippets.
3. Verifier bridge: run official SkillCraft evaluators on Datafetch outputs.

The first bridge slice now exists in `src/eval/skillcraftFullDatafetch.ts`:
task selection, workspace mirroring, official evaluator invocation, and
normalization-compatible result rows. It is intentionally marked not ready for
representative results until the local-tool bridge and learned-interface
execution path are implemented.

The contracts in this directory define the expected boundaries. They are kept
separate from implementation so reviewers can inspect fairness without reading
runtime code.
