# Wave Program Plan

## Purpose

The Wave Program is Opuity's structure for coordinating external contributors.
Maintainers define small, well-scoped issues; contributors claim them during
time-boxed sprint cycles and deliver reviewed pull requests. The program runs
across both repositories:

- `opuity` — SDKs, MCP server, CLI, docs, examples.
- `opuity-frontend` — Next.js x402 seller app.

The goal is predictable delivery, low review overhead, and a clear path from
first contribution to merged code.

## Objectives

- Turn the roadmap into discrete, independently deliverable issues.
- Give contributors unambiguous scope and acceptance criteria up front.
- Keep review cycles short and feedback consistent.
- Grow a pool of repeat contributors and future maintainers.

## Roles

| Role | Responsibility |
| --- | --- |
| Maintainer | Scopes and publishes issues, reviews PRs, merges, runs the cycle. |
| Contributor | Claims an issue, implements it, responds to review. |
| Reviewer | Second pair of eyes; at least one non-author on every merge. |
| Coordinator | Tracks board state, unblocks, reports cycle metrics. |

Maintainers retain final say on scope and merges.

## Sprint Cycle

Each cycle runs two weeks and has five stages.

1. **Scoping (day 1–2).** Maintainers publish the cycle's issues with labels,
   acceptance criteria, and a size estimate. Issues ship only when they are
   independently actionable.
2. **Claiming (day 3–4).** Contributors self-assign open issues. First
   qualified claim wins; maintainers confirm assignment and answer questions.
3. **Implementation (day 5–11).** Contributors work in branches off `main`,
   open draft PRs early, and keep changes scoped to the issue.
4. **Review (day 12–13).** Reviewers leave actionable feedback within one
   business day. Contributors address it; no unrelated changes are introduced.
5. **Merge and review (day 14).** Merged work lands on `main`. Maintainers run
   a short retrospective and publish metrics for the next cycle.

Unfinished work does not carry over automatically; it returns to the backlog
and is re-scoped.

## Issue Scoping Standards

Every issue must include:

- A one-line summary and background/context.
- In-scope and explicitly out-of-scope items.
- Testable acceptance criteria.
- A size label: `size:small` (≤1 day), `size:medium` (1–3 days),
  `size:large` (3–5 days). Nothing larger is offered without splitting.
- Required labels for area (`area:sdk`, `area:cli`, `area:docs`,
  `area:frontend`) and type (`type:bug`, `type:feature`, `type:docs`).

Issues missing any of these are returned to the maintainer, not the pool.

## Claiming and Assignment

- One active issue per contributor at a time, except maintainers.
- Comment on the issue to claim; assignment confirms it.
- Inactivity for three consecutive days without notice releases the claim.
- Questions are encouraged in the issue thread, where answers are preserved.

## Definition of Done

A pull request is mergeable only when:

- Acceptance criteria are met and demonstrated.
- Tests and lint/type checks pass in CI.
- Documentation is updated where behavior or usage changes.
- The PR references its issue and states that it is not bounty-linked.
- At least one reviewer approves and no blocking comments remain.

## Communication

- Issue threads are the system of record for decisions.
- Sprint board columns: `Backlog`, `Ready`, `In Progress`, `Review`, `Done`.
- Weekly async status note from the Coordinator: progress, blockers, risks.
- Significant scope changes are announced before implementation resumes.

## Metrics

Reviewed at the end of every cycle:

- Issues scoped vs. issues completed.
- Median time from claim to first review and to merge.
- Review rounds per PR.
- Repeat-contributor rate.

Metrics inform the next cycle's sizing and scope; they are not performance
ratings for individuals.

## Governance and Continuity

- Contributors who land consistent, high-quality work are invited to review,
  then to become maintainers.
- The program pauses between funded campaigns; the board is the source of
  truth for what is currently open.
- Any changes to this plan are proposed by PR and merged by maintainers.

## Status

Program cadence is not currently active. This plan defines the structure to
resume when the next cycle opens; watch the issues page rather than pinging
old threads.
