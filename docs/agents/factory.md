# Software factory

Agents that explore, build and review this repository's tickets in GitHub
Actions. The interface is labels: put one on an issue or PR and a workflow
picks it up. Spec: #35.

## How it works

- **Labels start everything.** Only collaborators can apply labels, so only
  collaborators can start the factory.
- **Every change arrives as a draft PR.** The reviewer marks it ready once it
  has posted a verdict. Merging is always a human's job.
- **The board is the state.** The workflows remember nothing between runs; the
  labels, issues and PRs on GitHub are what they read to decide what to do.
- **Retry by re-adding the trigger label.** A failed run marks its issue or PR
  `agent:blocked` and comments with a link to the logs.
- **No real devices.** Agents verify against the fakes in the test harness and
  never talk to the charger, the solar system or the P1 meter. No device or
  vendor credentials are stored in Actions.
- **Only collaborators steer the agents.** Agents read comments only from
  people with write access. The factory's own status comments carry a hidden
  `<!-- factory:status -->` marker and are filtered out.

## Labels

| Label                  | On       | Applied by                             | Meaning                                                   |
| ---------------------- | -------- | -------------------------------------- | --------------------------------------------------------- |
| `agent:explore`        | issue    | a person                               | Explore this ticket with the rest of the batch            |
| `agent:implement`      | issue    | a person, or explore (easy call)       | Build this ticket and open a draft PR                     |
| `agent:review`         | PR       | implement, implement-spec, or a person | Review this PR with no memory of the build                |
| `agent:implement-spec` | issue    | a person                               | Work this spec's sub-issues as a queue                    |
| `agent:in-progress`    | issue/PR | the factory                            | An agent is working on this right now                     |
| `agent:blocked`        | issue/PR | the factory                            | A run failed here; its comment says how to retry          |
| `needs-a-human`        | issue    | explore                                | Explore found open questions; settle them, then implement |

The triage labels (`needs-triage`, `ready-for-agent`, ...) and the
`wayfinder:*` labels are separate and unchanged; see
[triage-labels.md](./triage-labels.md). `needs-a-human` is not
`ready-for-human`: it means the ticket has open questions for you to settle,
after which an agent can still build it.

## Setup

Two repository secrets, `CLAUDE_CODE_OAUTH_TOKEN` and `FACTORY_PAT`, and the
four trigger labels. Without them nothing fires.

Run `scripts/setup-factory.sh` to set them up. It walks you through creating
the fine-grained token, saves both secrets, creates the trigger labels
(existing labels are left untouched) and optionally protects `main`. It is
safe to re-run, e.g. when a token expires.

## Workflows

### Explore

_To be written in #40._

### Implement

Ticket in, draft PR out. Workflow: `.github/workflows/agent-implement.yml`.
Agent: `.sandcastle/agent-workflows/implement/`, a Sandcastle script and its
prompt.

**Trigger.** Put `agent:implement` on an issue, or let explore do it for an
easy ticket. Any other label does nothing. One run per issue at a time: a
second label event waits for the first run to finish.

**What happens.**

1. `agent:implement` and `agent:blocked` come off the issue and
   `agent:in-progress` goes on.
2. The repo is installed with pnpm on Node 24, with Claude Code and
   agent-browser restored from a weekly cache. The run fails here if
   `pnpm install` did not install the pre-commit hook.
3. The ticket is written to a file for the agent: the issue and the comments
   from people with write access, explore's findings included. The factory's
   status comments are left out.
4. The agent reads the glossary, the ADRs and the coding standards, builds the
   ticket test-first against the fakes in the test harness, and commits
   through the pre-commit hook. It never talks to real devices and holds no
   GitHub token.
5. A run with no commits, or with uncommitted changes left over, fails here.
6. The commits are pushed to a new branch, `agent/issue-<n>-<run id>`, and a
   **draft** PR opens with the agent's summary, any screenshots, and
   `Closes #<n>`.
7. The PR gets `agent:review`, which starts the reviewer. If that fails, the
   run fails: there is no silent fallback.
8. The issue gets a status comment linking the run's logs, and
   `agent:in-progress` comes off.

**Labels.**

| Label               | When                                    |
| ------------------- | --------------------------------------- |
| `agent:implement`   | You add it; removed when the run starts |
| `agent:in-progress` | On the issue while the run is going     |
| `agent:blocked`     | On the issue if the run failed          |
| `agent:review`      | On the PR once it is open               |

**Retry.** A failed run leaves `agent:blocked` and a comment linking the logs.
Re-add `agent:implement` to retry; each retry pushes to a branch of its own,
so it never collides with an earlier run. If the PR was opened but the
hand-off failed, the comment says so: add `agent:review` to the PR instead, or
a retry opens a second PR.

### Review

_To be written in #39._

### Implement spec

_To be written in #41._
