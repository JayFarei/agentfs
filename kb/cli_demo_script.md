# AtlasFS Terminal Demo Script

## Goal

Show AtlasFS starting from a clean project memory folder, querying real FinQA
data in MongoDB Atlas, discovering primitives, creating procedures, creating a
live agent, then reusing that agent and procedure on later intents.

Target length: 3-5 minutes.

## Before Recording

Open a new terminal so `~/.zshrc` loads the `atlasfs` alias.

If the terminal is already open:

```sh
source ~/.zshrc
```

Confirm the alias:

```sh
alias atlasfs
```

Expected:

```sh
atlasfs='pnpm --dir /Users/jayfarei/src/tries/2026-05-01-hackathon atlasfs'
```

Optional cleanup if you want a predictable folder:

```sh
rm -rf /tmp/atlasfs-live-demo
```

## Recording Flow

### 1. Open With The Setup

Say:

> This is AtlasFS. I am starting from a clean local project memory folder, but
> the data path is live: MongoDB Atlas, Atlas Search, and Flue-backed agents.
> The point of the demo is to show the system learning reusable procedures from
> primitive calls, then reusing them for future intents.

Run:

```sh
atlasfs atlas-status
```

Point out:

- `atlasfs_hackathon`
- FinQA case count
- search unit count
- both Search indexes are `READY` and `queryable`

### 2. Run The Full Live Demo

Say:

> Now I will run the full demo from a clean project memory folder. Nothing in
> this folder has procedures or agents yet.

Run:

```sh
atlasfs demo --project /tmp/atlasfs-live-demo --reset
```

### 3. Narrate The First Intent

When the output shows `Intent 1`, say:

> The first question has no saved procedure, so AtlasFS composes primitive
> calls. It uses Atlas Search to find the filing, resolves the table, infers a
> table-math plan, executes it, and saves a new `table_math` procedure.

Point out:

- `mode: novel`
- `finqa_cases.findSimilar [MongoDB Atlas Search]`
- `finqa_table_math.execute`
- `procedure_store.save`
- added `table_math.json` and `table_math.ts`

### 4. Narrate The Replay

When the output shows `Intent 2`, say:

> This is the same family of intent with a different row. AtlasFS no longer
> needs the whole primitive chain. It matches the saved procedure and runs one
> procedure call.

Point out:

- `mode: procedure`
- `procedures.table_math [stored procedure]`
- `artifacts: no new files`

### 5. Narrate The Live Agent Creation

When the output shows `Intent 3`, say:

> This intent needs judgment over document language, so AtlasFS uses live
> Flue-backed agents. The observer creates a reusable scorer agent interface,
> the scorer evaluates document units, and the observer writes deterministic
> glue around the typed agent output.

Point out:

- `finqa_outlook.createOutlookScorerAgentSpec [live agent]`
- `agent_store.save [new reusable agent]`
- `finqa_outlook.scoreUnits [live agent]`
- `finqa_observe.codifyTableFunction [live agent]`
- added `negativeOutlookReferenceScorerAgent.json`
- added `negative_outlook_references.json` and `.ts`

### 6. Narrate Agent Reuse

When the output shows `Intent 4`, say:

> This second question asks for a narrower extraction: titles or quotes only.
> AtlasFS reuses the existing scorer agent. Notice there is no new agent
> creation step. It only writes new glue for this new procedure.

Point out:

- `agent_store.findReusable`
- no `finqa_outlook.createOutlookScorerAgentSpec`
- no `agent_store.save`
- added `negative_outlook_title_or_quote_references.json` and `.ts`

### 7. Close With Procedure Replay

When the output shows `Intent 5`, say:

> Now the evolved intent is executable as one stored procedure call. The
> project memory contains reusable procedures and a reusable agent that future
> intents can build on.

Point out:

- `mode: procedure`
- `procedures.negative_outlook_title_or_quote_references [stored procedure]`
- `artifacts: no new files`
- final inventory includes:
  - `table_math`
  - `negative_outlook_references`
  - `negative_outlook_title_or_quote_references`
  - `negativeOutlookReferenceScorerAgent`

## Backup Commands

If the demo folder is not clean:

```sh
atlasfs demo --project /tmp/atlasfs-live-demo --reset
```

If Atlas status is not ready:

```sh
atlasfs setup-search --timeout-ms 240000
atlasfs atlas-status
```

If shell does not know `atlasfs`:

```sh
source ~/.zshrc
alias atlasfs
```

If you need to show the generated artifacts after the run:

```sh
find /tmp/atlasfs-live-demo/.atlasfs -maxdepth 4 -type f | sort
```

## One-Line Version

For a short recording, run only:

```sh
atlasfs demo --project /tmp/atlasfs-live-demo --reset
```

Then narrate the five visible stages:

1. clean memory folder
2. novel primitive chain
3. stored procedure replay
4. live agent creation
5. agent reuse plus final procedure replay
