# SkillCraft Fixture Contract

For every task directory:

```text
tasks/scaled_tasks/<family>/<level>
```

the importer must preserve:

- `task_config.json`
- optional `initial_workspace/`
- optional `groundtruth_workspace/`
- optional `preprocess/main.py`
- required `evaluation/main.py`
- declared MCP servers and local tools
- output file contract inferred from evaluator and task docs

The importer must not convert the task into a synthetic `records` table unless
that is the native task representation. Full-benchmark claims require the
official task workspace and evaluator.

