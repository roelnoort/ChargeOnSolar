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

## Workflows

### Explore

_To be written in #40._

### Implement

_To be written in #38._

### Review

_To be written in #39._

### Implement spec

_To be written in #41._
