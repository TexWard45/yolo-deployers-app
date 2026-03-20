# [BUSINESSFLOW] Automation Flow: Single Source of Truth

This document is the canonical end-to-end flow for support automation in this app.

## Scope

This flow covers:
- Customer message intake
- Chatbot triage decisions
- Sentry-based summarization
- Jira ticket creation
- Human escalation/review
- Draft PR creation with Jira linking
- Auto-debug artifact generation
- Resolution and closure

## Status Model

Primary issue lifecycle statuses:

1. `OPEN`
2. `CHATBOT_COLLECTING_CONTEXT`
3. `READY_FOR_SUMMARY`
4. `READY_FOR_JIRA`
5. `ESCALATED_REVIEW`
6. `JIRA_CREATED`
7. `READY_FOR_PR`
8. `PR_DRAFT_CREATED`
9. `IN_PROGRESS`
10. `RESOLVED`
11. `CLOSED`

## Full ASCII Flow

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                              FULL AUTOMATION FLOW (END-TO-END)                              │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

[Customer]
   |
   | 1) sends message
   v
[Issue Intake API]
   |
   | create Issue {OPEN}
   | create status event
   v
[AI Triage Agent]
   |
   | decision: enough context?
   +-----------------------------+
   | NO                          | YES
   v                             v
[CHATBOT_COLLECTING_CONTEXT]   [READY_FOR_SUMMARY]
   |                             |
   | ask follow-up question      | fetch Sentry logs/events
   | wait customer reply         | build technical summary
   | append conversation         | create reasoning steps
   +-------------loop------------+
                                 |
                                 | decision: valid engineering issue?
                                 +-----------------------------+
                                 | NO                          | YES
                                 v                             v
                         [ESCALATED_REVIEW]             [READY_FOR_JIRA]
                                 |                             |
                                 | human review                | create Jira ticket
                                 | (approve/reject/route)      | store Jira artifact
                                 +-------------+---------------+
                                               |
                                               v
                                       [JIRA_CREATED]
                                               |
                                               | user clicks "Create Draft PR"
                                               v
                                       [READY_FOR_PR]
                                               |
                                               | create branch + draft PR
                                               | link Jira key + Issue ID
                                               | store PR artifact
                                               v
                                      [PR_DRAFT_CREATED]
                                               |
                                               | run auto-debug bundle
                                               | attach debug artifacts/log links
                                               v
                                         [IN_PROGRESS]
                                               |
                                               | fix implemented + merged
                                               v
                                           [RESOLVED]
                                               |
                                               | generate closure message
                                               | approve/send to customer
                                               v
                                            [CLOSED]
```

## Decision Gates

### Gate A: Context sufficiency

- Input: customer conversation + extracted issue details
- Output:
  - Continue chatbot (`CHATBOT_COLLECTING_CONTEXT`), or
  - Proceed to summary (`READY_FOR_SUMMARY`)

### Gate B: Engineering validity

- Input: Sentry summary + issue classification + confidence
- Output:
  - Escalate to reviewer (`ESCALATED_REVIEW`), or
  - Move to Jira creation (`READY_FOR_JIRA`)

### Gate C: PR readiness

- Preconditions:
  - Jira artifact exists
  - Issue has summary/context
  - No active duplicate draft PR
- Output:
  - Create draft PR (`PR_DRAFT_CREATED`) and run auto-debug

## Artifact Contracts

Each issue may produce these external artifacts:

1. Sentry summary artifact
2. Jira ticket artifact
3. GitHub draft PR artifact
4. Auto-debug report artifact

Artifact fields should include:
- `type`
- `externalId`
- `url`
- `title`
- `metadata`

## Escalation and Recovery

Any failed or low-confidence automation step must:

1. Record a run entry with failed state and error payload.
2. Transition issue status to `ESCALATED_REVIEW`.
3. Provide reviewer actions:
   - Retry failed step
   - Continue chatbot context collection
   - Force Jira creation
   - Close as non-actionable

## UI Expectations

Inbox/dashboard must make these states visible:

1. Waiting on customer context
2. Waiting on human review
3. Ready for Jira
4. Ready for PR
5. In progress / resolved / closed

Issue detail page must show:

1. Conversation context
2. AI reasoning
3. Sentry summary
4. Jira link/status
5. PR link/status
6. Auto-debug output
7. Escalation banner (if active)

## Ownership Boundaries

1. Intake + state transitions: `@shared/rest` issue/automation routers
2. AI analysis + closure generation: `apps/web/src/lib/ai/*`
3. External integrations: `apps/web/src/lib/integrations/*`
4. Canonical types/schemas: `@shared/types`
5. Persistence: Prisma models under `packages/database/prisma/*.schema.prisma`

## Notes

- This document is the reference flow for implementation and reviews.
- If implementation diverges from this flow, update this file in the same PR.
- Related implementation planning doc: `docs/eng-spec-full-automation-jira-pr-flow.md`.
