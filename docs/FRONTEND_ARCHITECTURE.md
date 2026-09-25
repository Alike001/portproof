# PortProof Frontend Architecture

## Decision
PortProof will ship as one deployable TypeScript application with:
- React + TypeScript + Vite for the browser UI
- Tailwind CSS + shadcn/ui primitives for accessible interface building blocks
- React Router for `/`, `/verify`, and `/report/:runId`
- Node.js + Express for the local/server runtime
- PortProof deterministic verification code shared by CLI and server
- Server-Sent Events (SSE) for real run progress

For the hackathon, prefer one repository and one deployable service rather than a multi-package monorepo. The Node server serves the built Vite frontend and owns filesystem/git/process operations.

Recommended deployment: a Linux Node service such as Render, because PortProof needs temporary workspaces, Git, and child-process execution. The prepared demo must also work locally without any cloud dependency.

## Product truth rule
The frontend may animate or format evidence, but it must never invent evidence.

Real product data:
- cherry-pick/mechanical result
- test command and exit code
- proof command and exit code
- stdout/stderr excerpts
- expected and observed behavior
- Behavior Contract contents
- source/target mapping evidence
- repair diff
- rerun result
- final verdict
- real command durations

Presentation-only data allowed:
- hero example card marked `Example`
- animation timing and stagger
- explanatory copy
- decorative branch/commit visuals
- placeholder skeletons while a real run is pending

Never fake:
- a PASS/FAIL result
- a Bob task as if it happened live when it came from a saved artifact
- a commit SHA or file path that was not part of the run
- a timing or impact metric that was not measured
- an AI confidence score

## Bob runtime honesty
Bob IDE is a core part of the PortProof workflow, but Bob does not need to run inside the deployed web page.

The Bob-native workflow creates auditable artifacts in the repository:
- Behavior Contract
- source analysis evidence
- target analysis evidence
- target-native proof proposal
- repair proposal when needed

The web application renders those saved Bob-generated artifacts and runs deterministic verification itself.

The UI must label this accurately:
- `Bob-generated analysis` for saved artifacts
- `Deterministic verification` for commands PortProof executes

Do not show `Bob is analyzing...` in the hosted demo unless a real Bob task is actually running.

## Routes

### `/` Landing
Goal: explain the problem in under 10 seconds and launch the prepared proof.

Above the fold:
1. Site header
2. Hero message
3. Contradiction preview
4. Primary CTA: `Run the broken backport demo`
5. Secondary CTA: `See how proof works`

Below the fold:
- three-step product explanation
- why Git + normal CI can miss semantic drift
- Bob-native workflow
- Backport Proof Report preview
- trust/open-source section

The landing page is marketing + education. It must not pretend to be the actual verifier.

### `/verify?scenario=timeout-zero`
Goal: run and understand one backport proof end to end.

Default judge path loads the prepared fixture and is ready to run immediately.

Desktop layout:
1. Run header
2. Dominant verdict strip
3. Phase timeline
4. Mechanical vs Semantic split
5. Behavior Contract
6. Source vs Target mapping
7. Bob evidence panel
8. Proof runner evidence
9. Repair panel when NOT_PROVEN
10. Logs/evidence drawer

### `/report/:runId`
Goal: show an immutable, read-only Backport Proof Report for audit and demo sharing.

Show:
- source/target provenance
- mechanical result
- existing tests
- Behavior Contract
- source/target mapping
- proof command and result
- repair diff when present
- rerun history
- final verdict
- link/download for raw JSON report

## Component tree

```text
App
├── AppShell
│   ├── SiteHeader
│   └── Router
│
├── LandingPage
│   ├── HeroSection
│   │   ├── HeroCopy
│   │   ├── HeroActions
│   │   └── ContradictionPreview
│   ├── DemoLauncher
│   ├── HowItWorksSection
│   ├── SemanticGapSection
│   ├── BobNativeWorkflowSection
│   ├── ProofReportPreview
│   └── TrustSection
│
├── VerifyPage
│   ├── RunHeader
│   ├── VerdictStrip
│   ├── PhaseTimeline
│   ├── EvidenceGrid
│   │   ├── MechanicalChecksCard
│   │   └── SemanticProofCard
│   ├── BehaviorContractCard
│   ├── SourceTargetMapping
│   ├── BobEvidencePanel
│   ├── ProofRunnerPanel
│   ├── RepairPanel
│   └── EvidenceDrawer
│       ├── CommandOutput
│       ├── FileEvidence
│       └── RawJsonView
│
└── ReportPage
    ├── ReportHeader
    ├── VerdictStrip (read-only)
    ├── ProvenanceCard
    ├── BehaviorContractCard (read-only)
    ├── SourceTargetMapping (read-only)
    ├── ProofRunnerPanel (read-only)
    ├── RepairHistory
    └── RawReportActions
```

## Suggested frontend files

```text
src/
├── web/
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes/
│   │   ├── LandingPage.tsx
│   │   ├── VerifyPage.tsx
│   │   └── ReportPage.tsx
│   ├── components/
│   │   ├── shell/
│   │   │   ├── SiteHeader.tsx
│   │   │   └── PageContainer.tsx
│   │   ├── landing/
│   │   │   ├── HeroSection.tsx
│   │   │   ├── ContradictionPreview.tsx
│   │   │   ├── DemoLauncher.tsx
│   │   │   ├── HowItWorksSection.tsx
│   │   │   ├── BobNativeWorkflowSection.tsx
│   │   │   └── ProofReportPreview.tsx
│   │   ├── proof/
│   │   │   ├── RunHeader.tsx
│   │   │   ├── VerdictStrip.tsx
│   │   │   ├── PhaseTimeline.tsx
│   │   │   ├── MechanicalChecksCard.tsx
│   │   │   ├── SemanticProofCard.tsx
│   │   │   ├── BehaviorContractCard.tsx
│   │   │   ├── SourceTargetMapping.tsx
│   │   │   ├── BobEvidencePanel.tsx
│   │   │   ├── ProofRunnerPanel.tsx
│   │   │   ├── RepairPanel.tsx
│   │   │   └── EvidenceDrawer.tsx
│   │   └── ui/                    # shadcn primitives only
│   ├── hooks/
│   │   ├── useProofRun.ts
│   │   └── useRunEvents.ts
│   ├── state/
│   │   └── proofRunReducer.ts
│   ├── lib/
│   │   ├── api.ts
│   │   ├── format.ts
│   │   └── status.ts
│   └── styles/
│       └── globals.css
│
├── server/
│   ├── index.ts
│   ├── routes/
│   │   ├── runs.ts
│   │   └── reports.ts
│   └── runStore.ts
│
├── core/
│   ├── contract/
│   ├── verifier/
│   ├── git/
│   ├── report/
│   └── workspace/
│
├── cli/
│   └── index.ts
│
└── shared/
    └── types.ts
```

The exact folders may change after Bob Plan mode, but the responsibility boundaries should remain.

## Backend API for the UI

### `POST /api/runs`
Creates an isolated run workspace.

Request:
```json
{
  "scenario": "timeout-zero",
  "variant": "clean-backport"
}
```

Response:
```json
{
  "runId": "run_...",
  "status": "QUEUED"
}
```

### `GET /api/runs/:runId/events`
SSE stream of real execution events.

Example event types:
- `run.started`
- `mechanical.started`
- `mechanical.completed`
- `tests.started`
- `tests.completed`
- `contract.loaded`
- `proof.started`
- `proof.completed`
- `verdict.completed`
- `repair.applied`
- `reverify.completed`
- `run.failed`

The frontend animation is driven by these real events.

### `GET /api/runs/:runId`
Returns current/final report JSON.

### `POST /api/runs/:runId/repair`
Applies the prepared target-native repair artifact in that run's isolated workspace, reruns tests + proof, and appends to the same report history.

For the hackathon fixture, the repair artifact should be a real patch file produced/reviewed through the Bob workflow, not a fabricated UI state change.

### `GET /api/reports/:runId`
Returns immutable report JSON suitable for the report page.

## Run state model

Use a discriminated union + `useReducer`. Avoid a large collection of unrelated booleans.

```text
IDLE
  ↓
PREPARING
  ↓
MECHANICAL_RUNNING
  ↓
TESTS_RUNNING
  ↓
CONTRACT_READY
  ↓
PROOF_RUNNING
  ├──> NOT_PROVEN
  │       ↓
  │   REPAIR_READY
  │       ↓
  │   REPAIR_APPLYING
  │       ↓
  │   REVERIFY_RUNNING
  │       ├──> PROVEN
  │       └──> NOT_PROVEN
  │
  ├──> PROVEN
  ├──> UNVERIFIABLE
  └──> ERROR
```

`NEEDS_HUMAN` is a final semantic verdict, not a transport/error state.

## Shared data contracts

### `CheckResult`
```ts
type CheckStatus = "PENDING" | "RUNNING" | "PASS" | "FAIL" | "SKIPPED"

interface CheckResult {
  id: string
  label: string
  status: CheckStatus
  command?: string
  exitCode?: number
  durationMs?: number
  outputExcerpt?: string
}
```

### `BobEvidence`
```ts
interface BobEvidence {
  role: "source-investigator" | "target-investigator" | "behavior-mapper" | "repair-agent"
  status: "COMPLETE" | "NOT_RUN"
  summary: string
  evidencePaths: string[]
  artifactPath?: string
}
```

Important: this object describes saved Bob-generated evidence. It must not imply a live Bob API call.

### `ProofRunReport`
```ts
interface ProofRunReport {
  id: string
  scenario: string
  source: GitRefEvidence
  target: GitRefEvidence
  mechanical: CheckResult[]
  contract: BehaviorContract
  mapping: SourceTargetMapping
  proof: CheckResult
  bobEvidence: BobEvidence[]
  repair?: RepairRecord
  verdict: "PROVEN" | "NOT_PROVEN" | "UNVERIFIABLE" | "NEEDS_HUMAN"
  createdAt: string
}
```

## Prepared fixture behavior
The primary judge demo should perform real work:
1. Backend creates an isolated fixture workspace.
2. It checks the clean backport candidate.
3. It runs the target's existing tests.
4. It loads the Bob-produced Behavior Contract artifact.
5. It executes the public-behavior proof.
6. Proof fails and report becomes `NOT_PROVEN`.
7. User chooses `Apply target-native repair`.
8. Backend applies the real repair patch.
9. Existing tests rerun.
10. Same proof reruns.
11. Report becomes `PROVEN` only if commands actually pass.

## Landing page data policy
The hero contradiction may be rendered immediately from a static example object so the page is understandable before a backend call.

It must visibly say `Example` or `Demo scenario`.

Once the user clicks `Run the broken backport demo`, every changing status on `/verify` comes from the real run API.

## UX hierarchy
1. Final verdict
2. Contradiction: mechanical PASS vs semantic FAIL
3. Behavior Contract
4. Source/target reason
5. Deterministic command evidence
6. Bob-generated investigation evidence
7. Raw logs

Do not make raw logs the first thing a judge sees.

## Visual system
- Background: near-black neutral, not blue/purple AI gradients
- Typography: IBM Plex Sans for UI and IBM Plex Mono for evidence/commands if available through normal web-font/package use
- Main status colors are reserved for state, not decoration
- Use borders, spacing, and typography before shadows
- One restrained accent for links/actions
- Motion should reveal state transitions, never distract from evidence

## Landing hero wireframe

```text
┌─────────────────────────────────────────────────────────────────────┐
│ PortProof                                      GitHub   How it works │
├─────────────────────────────────────────────────────────────────────┤
│ Semantic backport verification                                     │
│                                                                     │
│ A clean cherry-pick proves the code moved.                          │
│ PortProof proves the fix moved.                                     │
│                                                                     │
│ IBM Bob maps the intended behavior onto the older release branch.  │
│ Deterministic proof decides whether the fix survived.               │
│                                                                     │
│ [ Run broken backport demo ]   [ See how proof works ]              │
│                                                                     │
│                Demo scenario                                       │
│      ┌──────────────────────────────────────┐                       │
│      │ Git                  CLEAN           │                       │
│      │ Existing tests       PASS            │                       │
│      │ Behavior proof       FAIL            │                       │
│      │                                      │                       │
│      │ PORTPROOF         NOT PROVEN         │                       │
│      │                                      │                       │
│      │ expected 0 · observed 5000           │                       │
│      └──────────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Verify workspace wireframe

```text
┌──────────────────────────────────────────────────────────────────────┐
│ PortProof   timeout-zero     main → release/1.x        [Run proof]  │
├──────────────────────────────────────────────────────────────────────┤
│ GIT CLEAN        TESTS PASS        BEHAVIOR FAIL      NOT PROVEN     │
├────────────────────────────────┬─────────────────────────────────────┤
│ Mechanical                     │ Semantic                            │
│ Cherry-pick clean              │ Contract: zero disables timeout     │
│ Existing tests 3/3             │ Expected: 0                         │
│                                │ Observed: 5000                      │
├────────────────────────────────┴─────────────────────────────────────┤
│ Source main                      Target release/1.x                   │
│ parseModernTimeout               public path → parseLegacyTimeout    │
│ copied test → modern helper       production bypasses copied fix     │
├──────────────────────────────────────────────────────────────────────┤
│ Bob-generated investigation                                         │
│ ✓ source investigator   ✓ target investigator   ✓ behavior mapper    │
├──────────────────────────────────────────────────────────────────────┤
│ Deterministic proof                                                  │
│ npm run proof   exit 1   184ms                                      │
│ REQUEST_TIMEOUT_MS=0 → timeout 5000                                 │
│                                                                      │
│ [View evidence]                  [Apply target-native repair]         │
└──────────────────────────────────────────────────────────────────────┘
```

## Accessibility
- Every PASS/FAIL state has text + icon, not color only.
- Keyboard focus order follows visual hierarchy.
- `aria-live` announces run-state changes without reading every log line.
- Respect `prefers-reduced-motion`.
- Evidence output uses selectable, scrollable text.
- Target WCAG AA contrast.

## Frontend acceptance criteria
1. Hero explains PortProof without scrolling.
2. Primary demo starts in one click.
3. A judge reaches `NOT_PROVEN` without entering credentials or data.
4. All verifier statuses on `/verify` come from real backend execution.
5. `Apply target-native repair` changes the verdict only after real reruns pass.
6. Mechanical PASS and semantic FAIL are visually impossible to confuse.
7. Bob-generated evidence is clearly separated from deterministic verification.
8. Final report can be opened directly by URL and inspected without rerunning the demo.
9. The same UI handles `PROVEN`, `NOT_PROVEN`, `UNVERIFIABLE`, and `NEEDS_HUMAN` without special-case fake screens.
10. No unsupported metrics, confidence scores, or fabricated evidence are shown.
