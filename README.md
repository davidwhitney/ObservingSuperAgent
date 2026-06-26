# The Observing Super-Agent

An observing super-agent that watches work-tracking tools (JIRA first), selects work via
heuristics, uses an LLM to plan the change, dispatches it to a commodity AI coding agent
(GitHub Copilot first), annotates the source ticket, and background-polls the agent to completion
— all driveable over an HTTP API.

## How it works

```
JIRA ─▶ WorkTrackingConnector ─▶ Orchestrator ─▶ Planner (LLM + MCP) ─▶ AgentConnector ─▶ GitHub
                 ▲                     │                                       │
                 └──── AnnotateItem ◀──┴──── AgentMemory (text store) ◀────────┘
                                  Poller ─(POST /poll)─▶ getStatus ─▶ link / complete
                                  CommunicationAdapter[] (Console by default)
```

1. **Retrieve** — `WorkTrackingConnector.RetrieveWorkReadyForDispatch()` pulls items matching the
   `agent-ready` tag (configurable) or a ready column, honouring opt-in/opt-out scope, project
   exclusions, and per-project overrides.
2. **Plan** — the `Planner` invokes an `LlmAdapter` with the full ticket context (description **and
   the comment thread**) to produce `{ repositories, prompt }`, recorded in `AgentMemory`. With
   Foundry Local, the configured MCP servers (GitHub by default) are offered to the model as tools
   via `McpClientPool`, so it can browse repositories before planning. If the ticket lacks the
   detail needed to plan, the planner instead **asks for clarification** (see below).
3. **Dispatch** — an `AgentConnector` (GitHub Copilot by default) creates an issue per repository
   and assigns it to the agent (via the GitHub MCP `assign_copilot_to_issue` tool when available).
   The ticket is then moved to the **acting** state: `agent-ready` → `agent-acting` (and/or a
   configured `actingColumn`), plus a linking comment.
4. **Poll** — `POST /poll` refreshes each run, links opened PRs, and advances the ticket through
   the rest of its lifecycle: PR **ready for review** → `agent-complete` + completion column (e.g.
   `In Review`); PR **merged** → done column (e.g. `Done`); PR **closed unmerged** → done column +
   `reviewer-rejected` tag. In-review records keep being polled until the PR resolves.

### Clarification loop

The planner can hold a loose conversation on the ticket before committing to a plan. If it lacks
information (which repo, unclear scope/acceptance criteria), instead of guessing it posts its
questions as a comment, the item is recorded as **`clarifying`** (kept `agent-ready`, not
dispatched), and nothing else happens until a human replies. The next cycle only re-evaluates an
item once it has **new comments** since the questions were asked — at which point the planner sees
the whole thread (its questions + the answers) and either asks again or proceeds to dispatch. So:
tag a vague ticket `agent-ready`, answer the agent's follow-up questions in the comments, and it
plans better before dispatching.

## Requirements

- Node.js 24 LTS (latest LTS)
- No build step — runs straight from TypeScript via [tsx](https://github.com/privatenumber/tsx).

## Install & run

```bash
npm install
cp config.example.json config.json   # boots on fakes (no credentials needed)
npm start                             # serves the HTTP API
```

Then:

```bash
curl -XPOST localhost:8787/dispatch   # run a dispatch cycle
curl -XPOST localhost:8787/poll       # run a poll cycle
curl -XPOST localhost:8787/reconcile  # verify drift (dry-run); add ?apply=true to repair
curl       localhost:8787/status      # inspect the agent's memory
```

**Reconcile / verification pass.** `POST /reconcile` walks every memory record and reconciles it
against the live downstream state: it re-derives each record's correct status from the agent runs,
detects drift against the actual work-tracking item (tags/column, missing PR link, or a deleted
item), and reports it. It is **dry-run by default**; add `?apply=true` to repair — completing
records whose agent finished out of band, posting missing PR links, and re-asserting
tags/columns that were changed out of band. Idempotent. Useful during development and to absorb
manual edits to JIRA/GitHub. Locally: `npx tsx scripts/dry-run.ts --reconcile [--apply]`.

The example config wires the **fake** LLM and agent so the service boots and the API responds
without any external services. Configure a `jira` block (see below) and switch
`llm.provider` / `agent.provider` to drive real systems.

## Scripts

| Script              | Purpose                                  |
| ------------------- | ---------------------------------------- |
| `npm start`         | Run the API (`tsx src/index.ts`)         |
| `npm run dev`       | Run with watch/reload                    |
| `npm run typecheck` | Type-check with `tsgo` (TS 7.0 preview)  |
| `npm test`          | Run the component test suite with vitest |

## Configuration

Config is a JSON file (`config.json`, or `OSA_CONFIG=/path`) overlaid by environment variables.
`OSA_`-prefixed vars are split on `__` to form a path and match config keys case-insensitively:

```bash
OSA_API__PORT=9090 OSA_JIRA__APITOKEN=*** npm start
```

Secrets are best supplied via the environment rather than the file. To enable JIRA, add a
top-level `jira` block (the shape is shown under `_jira_example` in `config.example.json`).

As a convenience, a plain **`GITHUB_TOKEN`** env var is used as the fallback for both
`agent.github.token` and `mcp.github.token` when they aren't set explicitly (an explicit value in
the file or an `OSA_` override still takes precedence).

### Selection heuristics
- `mode: "opt-in"` only queries the listed `projectIds`; `"opt-out"` queries everything except
  `excludedProjectIds`.
- An item is ready if it carries `readyTag` (default `agent-ready`) **or** sits in a `readyColumns`
  status.
- **Board lifecycle config** lives in `jira.defaultConfig`; each `jira.projectConfig[<projectId>]`
  entry is the **same shape** and overrides `defaultConfig` for that project (field by field).
- Column fields (`readyColumns`, `actingColumn`, `completeColumn`, `doneColumn`) accept a single
  name **or a list**; the card moves to the **first candidate that exists on its board** (others are
  skipped), so one config can span boards with different column names.
- **Lifecycle transitions** (tags + first-matching column):
  - on **dispatch**: drop `readyTag`, add `actingTag` (default `agent-acting`); move to `actingColumn`.
  - on **review** (PR ready for review / review requested): drop `readyTag`/`actingTag`, add `completeTag` (default `agent-complete`); move to `completeColumn`.
  - on **merge**: drop the in-flight tags (`readyTag`/`actingTag`/`completeTag`); move to `doneColumn` (default `Done`); add `doneTag` if set.
  - on **close without merge**: drop the in-flight tags; move to `doneColumn`; add `rejectedTag` (default `reviewer-rejected`).

## Extension points (adapter pattern)

| Layer                | Interface                | Real reference          | Stubs (throw `NotImplementedError`)      |
| -------------------- | ------------------------ | ----------------------- | ---------------------------------------- |
| Work tracking        | `WorkTrackingConnector`  | `JiraConnector`         | —                                        |
| Memory               | `MemoryStore`            | `DiskBackedStorage`     | `AzureBlobStorage`                       |
| Planning model       | `LlmAdapter`             | `FoundryLocalAdapter`   | `AzureFoundry`, `CopilotCli`             |
| Agent runtime        | `AgentConnector`         | `GitHubCopilotAgentConnector` | —                                  |
| Communications       | `CommunicationAdapter`   | `ConsoleCommunicationAdapter` | `Teams`, `Slack`                   |

In-memory fakes for every layer live under `**/fakes/` and back the component test suite.

## Notes

- The connector contract is two methods (`RetrieveWorkReadyForDispatch`, `AnnotateItem`).
  `AnnotateItem` takes a structured annotation (comment + tag/transition changes) so lifecycle
  moves on completion stay within that contract. Connectors may optionally implement
  `LifecyclePolicy` to describe their completion move.
- Tests never touch the network: the JIRA and GitHub clients accept an injectable `fetch`, and the
  MCP tool-calling loop is covered via a fake `McpToolProvider`.
- MCP-assisted planning needs a Foundry Local model that supports tool/function calling. If the
  model emits no tool calls, planning still works — it just plans from the ticket text alone.
- **Foundry Local auto-start:** when `llm.provider` is `foundry-local` and `llm.autoStart` is true
  (the default), startup probes `llm.endpoint`; if nothing answers it starts the service via the
  Foundry Local SDK, downloads/loads `llm.model`, and uses the real bound endpoint (so the dynamic
  port is handled for you). The model downloads on first run. If Foundry isn't installed the app
  logs a warning and continues — set `llm.autoStart: false` to manage the service yourself.
  Run `npm run check` to start it and verify connectivity to every configured service.
