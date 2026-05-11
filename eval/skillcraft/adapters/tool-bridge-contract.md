# Tool Bridge Contract

SkillCraft task configs declare local tool bundles such as `weather_tools`,
`jsonplaceholder_api`, `worldbank_api`, `skill_cache`, and `claim_done`.

The Datafetch arm must expose equivalent atomic capabilities without making the
task easier:

- Atomic SkillCraft tools should be callable through a namespaced Datafetch
  surface such as `df.tool.<bundle>.<tool>(...)`.
- Learned compositions should still be promoted into `df.lib.*`.
- The bridge must log every underlying tool call so tool counts are comparable
  with native SkillCraft trajectories.
- `claim_done` remains an output/completion signal only; it should not bypass
  official evaluation.

The bridge must document any tool that cannot be represented faithfully.

Current implementation slice:

- `eval/skillcraft/scripts/invoke-skillcraft-tool.py` can list and invoke
  official SkillCraft local-tool bundles outside the native runner.
- It shims the minimal `agents.tool.FunctionTool` import surface and a small
  `requests.get` surface so schema listing and simple HTTP-backed tools work
  in a lightweight evaluator environment.
- This is not yet wired into the Datafetch snippet runtime as `df.tool.*`;
  representative results still require that runtime integration and tool-call
  accounting.
