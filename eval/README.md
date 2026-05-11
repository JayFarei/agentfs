# Evaluation Harnesses

This directory contains reproducible benchmark harnesses. Source code that is
part of the datafetch runtime remains under `src/`; this directory is for
release-facing protocols, manifests, scripts, result schemas, and reports.

## Harnesses

- `skillcraft/`: three-arm SkillCraft comparison for native SkillCraft base,
  native SkillCraft skill mode, and datafetch learned interfaces.

Large raw benchmark outputs are intentionally ignored under each harness'
`results/` directory. Publish those as release artifacts or datasets when a run
is ready to share.

