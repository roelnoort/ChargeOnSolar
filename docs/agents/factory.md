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

The cheap, read-only run in front of implement, over a batch of tickets.
Workflow: `.github/workflows/agent-explore.yml`. Agent:
`.sandcastle/agent-workflows/explore/`, a Sandcastle script, its prompt, the
plan schema and the plan check.

**Trigger.** Put `agent:explore` on one or more issues. The run explores
_every_ open issue carrying the label, together, as one batch, so duplicates
and shared root causes are noticed. Any other label does nothing. One batch at
a time, never cancelled: a label added mid-run queues one more run, which
picks up only the issues labelled since.

**What happens.**

1. A list job, with no agent, lists the batch with the factory token. Each
   issue and the comments from people with write access go into a file that
   is handed to the explore job, without the factory's status comments. Each
   issue swaps `agent:explore` (and any `agent:blocked`) for
   `agent:in-progress`.
2. The explore job installs the repo as in implement. It reads the shared
   tools cache but never saves to it, so nothing it does can reach a later
   implement or review run. The agent reads the glossary, the ADRs and the
   coding standards, groups related tickets, explores each group with a
   subagent, and hands back a plan: one entry per issue with a findings
   comment, a tag (`easy-call`, `needs-a-human` or `blocked`) and, for a
   duplicate, the surviving issue it duplicates. The factory token never
   enters this job, the job's built-in token can only read the code, and the
   agent writes nothing outside `/tmp`. It never talks to real devices.
3. A separate apply job, with no agent and no checkout, checks the plan with
   `plan-check.ts`: every batch issue exactly once, known tags, no empty
   comment, every duplicate pointing at a surviving issue in the batch. Any
   problem refuses the whole plan: nothing is written.
4. Apply posts each findings comment, with its screenshots attached, survivors
   before duplicates. Then it branches on the entry:
   - a duplicate is closed as a duplicate of its survivor;
   - `easy-call` gets `agent:implement`, which starts implement;
   - anything else gets `needs-a-human`.
5. A finish job marks every issue still `agent:in-progress` as
   `agent:blocked` with a comment linking the logs if the run failed, and
   always takes `agent:in-progress` off.

The findings comments carry no status marker, on purpose: implement reads
them as part of the ticket.

**Labels.**

| Label               | When                                                         |
| ------------------- | ------------------------------------------------------------ |
| `agent:explore`     | You add it; removed from the whole batch when the run starts |
| `agent:in-progress` | On each issue in the batch until apply moves it on           |
| `agent:implement`   | Apply adds it to an easy call                                |
| `needs-a-human`     | Apply adds it to anything else that survives                 |
| `agent:blocked`     | On each issue apply did not reach, if the run failed         |

**Retry.** A failed run, including a refused plan, leaves `agent:blocked` and
a comment linking the logs on every issue it did not finish. Re-add
`agent:explore` to retry. For `needs-a-human`, settle the open questions in a
comment, then add `agent:implement` yourself.

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

A review with no memory of the build. Workflow:
`.github/workflows/agent-review.yml`. Agent:
`.sandcastle/agent-workflows/review/`, a Sandcastle script and its prompt,
which loads the `code-review` skill.

**Trigger.** Put `agent:review` on a pull request, or let implement do it for
the PR it opened. Any other label does nothing. One review per PR at a time,
never cancelled: a second label event waits for the first run to finish. PRs
from forks are never reviewed.

**What it reads.** Only three things, each fetched by the run itself: the
diff against the base branch, [CODING_STANDARDS.md](../../CODING_STANDARDS.md),
and the issue the PR body says it closes (`Closes #n`), with comments from
people with write access. With no `Closes #n`, the Spec axis reports "no spec
available" and is never guessed. It never sees the implementer's session.

**What happens.**

1. `agent:review` and `agent:blocked` come off the PR and `agent:in-progress`
   goes on.
2. The PR's head is checked out and installed as in implement. The run fails
   here if `pnpm install` did not install the pre-commit hook.
3. The agent reviews on two separate axes, standards and spec. It fixes what
   it can as commits through the pre-commit hook, and writes a verdict. It
   holds no GitHub token and never talks to real devices.
4. The fixes are pushed onto the PR's branch, never forced. If someone pushed
   to the branch during the run, the push is rejected and the fixes go to a
   new branch, `<pr branch>-<run id>`, opened as a draft PR against the same
   base. The original PR gets `agent:blocked`: keep one of the two.
5. The verdict is posted as a comment. Findings it left unfixed are posted as
   one review with inline comments, on the PR the fixes went to. Comments on
   lines outside the diff are dropped, because GitHub rejects the whole
   review for one.
6. The PR is marked **ready for review**, on a fail as well as a pass, but
   only when a real verdict was posted. If the agent broke, the PR stays a
   draft. Ready is not approved: the merge stays yours.
7. `agent:in-progress` comes off.

**The verdict.**

```
## Standards: PASS | CHANGES REQUESTED
## Spec: PASS | CHANGES REQUESTED | NO SPEC AVAILABLE
## Rules this review wanted and could not find
```

Each finding says whether it was fixed (with its commit) or left (with its
file and line), citing the standard by heading. The last section lists what
the reviewer wanted to fail the change for that no standard covers:
candidates for new rules.

**Labels.**

| Label               | When                                                 |
| ------------------- | ---------------------------------------------------- |
| `agent:review`      | Implement or you add it; removed when the run starts |
| `agent:in-progress` | On the PR while the run is going                     |
| `agent:blocked`     | On the PR if the run failed or its push was rejected |

**Retry.** A failed run leaves `agent:blocked` and a comment linking the logs;
the PR stays a draft. Re-add `agent:review` to retry. After a rejected push,
close one of the two PRs, then re-add `agent:review` to the one you keep if
you want it reviewed again.

### Implement spec

_To be written in #41._
