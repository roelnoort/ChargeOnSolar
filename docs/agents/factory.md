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
Implement-spec calls this workflow for the next ticket in a spec's queue, and
its run for a ticket waits behind a label run for the same ticket, and the
other way round.

**What happens.** Four jobs. Only the build job runs the agent, and it is the
one job that never references the factory token, so the token is never on the
machine the agent runs on. The jobs that hold the token check nothing out and
run nothing the agent wrote.

1. **Prepare.** `agent:implement` and `agent:blocked` come off the issue and
   `agent:in-progress` goes on. The ticket is written to a file for the agent:
   the issue and the comments from people with write access, explore's
   findings included. The factory's status comments are left out.
2. **Build.** The repo is installed with pnpm on Node 24, with Claude Code and
   agent-browser restored from a weekly cache, which is saved before the agent
   runs, never after. The run fails here if `pnpm install` did not install the
   pre-commit hook.
3. The agent reads the glossary, the ADRs and the coding standards, builds the
   ticket test-first against the fakes in the test harness, and commits
   through the pre-commit hook. It never talks to real devices and holds no
   GitHub token.
4. A run with no commits, or with uncommitted changes left over, fails here.
   The commits are handed on as a `git bundle`, with the agent's PR body and
   screenshots.
5. **Publish.** The bundle is fetched into an empty bare repository, with no
   working tree and hooks off, and checked again: it must build on the commit
   the run started from and add at least one commit. It is pushed, never
   forced, to a new branch, `agent/issue-<n>-<run id>`, and a **draft** PR
   opens with the agent's summary, any screenshots, and `Closes #<n>`.
6. The PR gets `agent:review`, which starts the reviewer. If that fails, the
   run fails: there is no silent fallback.
7. **Finish.** On failure the issue gets `agent:blocked`. Either way it gets a
   status comment linking the run's logs, and `agent:in-progress` comes off.

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

**What happens.** Four jobs, shaped as in implement: only the review job runs
the agent and checks the PR out, and it never references the factory token.

1. **Prepare.** `agent:review` and `agent:blocked` come off the PR and
   `agent:in-progress` goes on. The spec is collected into a file for the
   agent.
2. **Review.** The PR's head is checked out and installed as in implement. The
   run fails here if `pnpm install` did not install the pre-commit hook.
3. The agent reviews on two separate axes, standards and spec. It fixes what
   it can as commits through the pre-commit hook, and writes a verdict. It
   holds no GitHub token and never talks to real devices. Uncommitted changes
   left over get a warning and are not pushed. The commits are handed on as a
   `git bundle`, with the verdict, the inline comments and any screenshots.
4. **Publish.** The bundle is fetched into an empty bare repository, with no
   working tree and hooks off, checked to build on the PR's head, and its
   fixes pushed onto the PR's branch, never forced. If someone pushed to the
   branch during the run, the push is rejected and the fixes go to a new
   branch, `<pr branch>-<run id>`, opened as a draft PR against the same base.
   The original PR gets `agent:blocked`: keep one of the two.
5. The verdict is posted as a comment. Findings it left unfixed are posted as
   one review with inline comments, on the PR the fixes went to. Comments on
   lines outside the diff are dropped, because GitHub rejects the whole
   review for one.
6. The PR is marked **ready for review**, on a fail as well as a pass, but
   only when a real verdict was posted. If the agent broke, the PR stays a
   draft. Ready is not approved: the merge stays yours.
7. **Finish.** `agent:blocked` on a failure or a rejected push, and
   `agent:in-progress` comes off.

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

A spec's sub-issues, worked as a queue, one ticket per run. Workflow:
`.github/workflows/agent-implement-spec.yml`. Deciders and agent:
`.sandcastle/agent-workflows/implement-spec/`: the queue decider, the split
script with its prompt, schema and plan check.

**Trigger.** Put `agent:implement-spec` on a spec issue, or start the workflow
from the Actions tab, optionally with a spec number. Without one it works the
lowest-numbered open issue labelled `agent:implement-spec`. The label stays on
the spec while its queue is worked: take it off to stop the queue. One run at
a time across the repository, never cancelled. Other labels never bump the
waiting run. A cron schedule is in the workflow, commented out.

**The queue.** The spec's GitHub sub-issues, in sub-issue order. A ticket is
buildable when it is open, not `agent:blocked`, not `agent:in-progress`, and
has no open native "blocked by" dependency. The first buildable one wins.
The rule lives in `queue.ts`, a pure function with Vitest tests. Its answer
is one of: split the spec, build ticket N, drained, all blocked, no spec.

**What happens.**

1. **Survey.** With no agent and no checkout, the run fetches the spec, its
   sub-issues and their dependency summaries as JSON with `gh`, and runs
   `queue.ts` on them, fetched from this commit. Every later job branches on
   the answer.
2. **Announce.** The answer goes on the spec as a status comment. On drained,
   `agent:implement-spec` comes off the spec. On all blocked, the comment
   lists why each open ticket could not be built.
3. **Build** a ticket by calling the implement workflow as a reusable
   workflow: the same jobs, script, prompt and token split as
   [Implement](#implement). The ticket is claimed with `agent:in-progress`,
   built, and a draft PR opens with `agent:review`. **Close** then closes the
   ticket. On failure the ticket stays open with `agent:blocked`, and the
   queue skips it from then on.
4. **Split** a spec with no sub-issues. An agent with no GitHub token reads
   the spec and the code and hands back tickets: title, body, and the earlier
   tickets each is blocked by. A job with no agent and no checkout checks the
   plan with `split-check.ts` (at least one ticket, no empty title or body,
   each blocked only by earlier tickets) and refuses it whole on any problem.
   Then it creates each ticket labelled
   `ready-for-agent` with `## Parent` pointing at the spec, attaches them as
   sub-issues in plan order, and adds the native "blocked by" dependencies.
   A spec is split at most once: announce marks it before the agent starts,
   and survey reads the mark.
5. **Chain.** After a split that created its tickets, or a build that
   finished, well or badly, the run starts the workflow again for the same
   spec. Not after a cancelled build. The queue stops on drained, all blocked
   or no spec.
6. **Finish.** A failure at spec level (survey, split, close, chain) marks the
   spec `agent:blocked` with a status comment linking the logs. A failed
   build is reported on its ticket by implement's own finish job.

**The chain has no run counter.** Its only brakes are the queue running out,
and chain refusing to start another run when a build left its ticket neither
closed nor `agent:blocked`, since the next run would pick it again. Take the
label off the spec to stop it by hand.

A ticket in progress (`agent:in-progress`) is skipped as well, so a queue run
never opens a second PR for a ticket another run is building. If the queue
fails to close a built ticket, the ticket gets `agent:blocked` and a comment.

**Closed is not merged.** A ticket is closed once its draft PR is open, so the
queue can move on. The next ticket is built from `main`, which does not have
the previous ticket's PR in it until you merge it. Tickets that depend on it
are unblocked by the close, not by the merge.

**One waiting run.** GitHub keeps one waiting run per concurrency group.
Labelling a second spec while a chain is going replaces the chain's waiting
run, so the first spec's queue waits until you start implement-spec for it
from the Actions tab.

**Labels.**

| Label                  | When                                                           |
| ---------------------- | -------------------------------------------------------------- |
| `agent:implement-spec` | You add it to the spec; removed when the queue is drained      |
| `agent:in-progress`    | On the ticket being built; on the spec while it is being split |
| `agent:blocked`        | On a ticket whose build failed; on the spec if a run failed    |
| `ready-for-agent`      | On every ticket a split creates                                |
| `agent:review`         | On each PR the queue opens                                     |

**Retry.** A ticket marked `agent:blocked` is skipped. Take the label off and
start implement-spec from the Actions tab to put it back in the queue, or add
`agent:implement` to build it on its own. When the queue stopped because all
remaining tickets are blocked, settle them, then start it again from the
Actions tab. A failed split is not retried: add the sub-issues by hand.
