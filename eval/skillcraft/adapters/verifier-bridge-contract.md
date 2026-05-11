# Verifier Bridge Contract

The official SkillCraft evaluator is the primary scorer.

For every Datafetch task episode:

1. Run the agent inside a workspace mirroring SkillCraft `initial_workspace/`.
2. Require the expected output file, for example `weather_report.json`.
3. Invoke the task's `evaluation/main.py` with:

```bash
--agent_workspace <workspace>
--groundtruth_workspace <groundtruth-or-empty>
```

4. Parse the `SCORE_JSON` block or evaluator result file.
5. Store the official pass/status/score in the normalized result row.

`df.answer(...)` may be retained for lineage and evidence, but it cannot replace
the official evaluator in the full SkillCraft comparison.

