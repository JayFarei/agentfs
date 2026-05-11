# Benchmarking The datafetch Thesis

This document is a handoff for evaluating datafetch against normal agentic
search.

## Claim To Test

datafetch should outperform normal agentic search when the same dataset is used
repeatedly and the questions have reusable intent structure.

The claim is not:

```text
datafetch beats search on every one-shot lookup.
```

The claim is:

```text
Given repeated sessions over the same dataset, a code-mode dataset harness
that learns visible intent programs should improve in correctness, evidence
quality, latency, cost, and robustness relative to fresh agentic search.
```

## Baseline

The baseline should be a strong agentic search setup:

```text
agent + dataset search/read API + prompt
```

The baseline agent should be allowed to search, inspect rows or documents, and
answer directly. It should not get datafetch's persistent learned interfaces.

Compare against datafetch in two modes:

- Cold path: no useful learned interface exists.
- Warm path: prior accepted episodes exist and learned interfaces may be
  discovered and reused.

## Benchmark Shape

Use repeated intent families, not isolated one-off questions.

Example structure:

```text
Dataset A

Round 1:
  intent family 1, query 1
  intent family 2, query 1
  intent family 3, query 1

Round 2:
  intent family 1, sibling query
  intent family 2, sibling query
  intent family 3, sibling query

Round 3:
  intent family 1, harder variant
  intent family 2, missing-evidence variant
  intent family 3, noisy variant
```

This tests whether the system improves over time, not just whether it can solve
one query.

## Dataset Requirements

Good benchmark datasets should have:

- multiple related questions over the same corpus;
- answer labels or independently verifiable outputs;
- evidence labels, row IDs, document IDs, or enough structure to verify
  citations;
- reusable intent families;
- ambiguity, missing evidence, or noisy candidates;
- enough schema variety that generic one-shot search is not trivial.

Promising dataset categories:

- financial table QA;
- trace/session datasets;
- customer support or incident datasets;
- scientific literature and table extraction;
- enterprise logs;
- mixed structured and semi-structured corpora.

Poor fits:

- independent one-shot QA only;
- tiny datasets where every answer is directly visible;
- tasks where the first search result contains the final answer;
- benchmarks that do not reward persistence, reuse, evidence, or abstention.

## Metrics

Track at least:

1. Correctness

Did the answer match the expected output?

2. Evidence quality

Did the answer cite the right rows, documents, tables, or spans?

3. Derivation visibility

Can a reviewer inspect how the value was produced?

4. Reuse rate

Did the warm-path agent call a learned `df.lib.*` interface instead of
recomposing from `df.db.*` primitives?

5. Cost

LLM calls, token use, tool calls, and runtime.

6. Latency

Wall-clock time for cold path, warm path, and baseline.

7. Robustness

Did the system return `partial` or `unsupported` when exact evidence was
missing?

8. Generalization

Did an interface learned from one query solve sibling variants without
regression?

9. Regression safety

Do replay tests continue to pass after a learned interface is changed or
generalized?

## Required Instrumentation

Run datafetch eval scenarios with telemetry enabled:

```sh
DATAFETCH_TELEMETRY=1
DATAFETCH_TELEMETRY_LABEL=<benchmark-id>
DATAFETCH_SEARCH_MODE=<cold|warm|baseline>
```

Collect:

```text
$DATAFETCH_HOME/telemetry/events.jsonl
<workspace>/result/answer.json
<workspace>/result/validation.json
<workspace>/result/lineage.json
<workspace>/result/tests/replay.json
```

For each query, store:

- prompt or user intent;
- dataset id;
- expected answer;
- expected evidence if available;
- model and agent driver;
- telemetry row;
- committed answer artifacts.

## Pass/Fail Questions

The benchmark should let us answer:

- Does datafetch cold path produce accepted, evidence-backed answers?
- Do future sessions discover prior learned interfaces?
- Does warm path reduce cost or latency?
- Does warm path maintain or improve correctness?
- Does it abstain safely on missing or mismatched evidence?
- Do learned interfaces generalize beyond exact repeats?
- Does replay catch regressions?

If datafetch fails, classify the cause:

- the dataset lacks reusable intent structure;
- the agent did not discover the learned interface;
- the learned interface was too narrow;
- the learned interface generalized incorrectly;
- validation was too weak;
- commit friction dominated latency;
- the benchmark rewards one-shot retrieval rather than persistence.

## Minimal First Eval

A first credible eval can be small:

```text
2 datasets
3 intent families per dataset
3 queries per family
2 modes: baseline agentic search vs datafetch warm path
```

Run datafetch cold path on the first query in each family. Then run sibling
queries as warm path. Compare against fresh baseline agentic search on the same
queries.

The first milestone is not to prove the final product. It is to find out where
the loop breaks: discovery, commit quality, distillation, generalization, or
cost.
