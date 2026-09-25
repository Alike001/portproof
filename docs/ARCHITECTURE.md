# PortProof — Final Architecture

Status: plan  
Scope: Hackathon MVP — JavaScript/TypeScript, local Git, deterministic proof runner

---

## Fixture ground truth (verified)

The fixture at `fixture/` contains four branches that prove the product thesis is real:

| Branch | `npm test` | `npm run proof` | PortProof verdict |
|---|---|---|---|
| `master` | PASS | PASS | PROVEN |
| `release/1.x` | PASS | FAIL | NOT_PROVEN |
| `demo-clean-backport` | PASS | FAIL | NOT_PROVEN |
| `demo-proven-backport` | PASS | PASS | PROVEN |

### Why `demo-clean-backport` is the dangerous case

`master` introduced the bug fix in two sequential commits:
1. `df135a3` — `refactor: route request timeout through modern parser` — changed `createRequestOptions` to call `parseModernTimeout`
2. `49bbeb3` — `fix: allow zero request timeout to disable timeout` — corrected `parseModernTimeout`'s zero-handling

The cherry-pick onto `release/1.x` applied only `49bbeb3` — the fix to the function body — not `df135a3`, the routing change. The result:

- `parseModernTimeout` is now defined correctly on `release/1.x`
- `createRequestOptions` still routes through `parseLegacyTimeout`
- A copied regression test exercising `parseModernTimeout` directly passes
- The public API behavior test (`REQUEST_TIMEOUT_MS=0 → 0`) fails because it exercises the real routing path

This is not a contrived edge case. It is the canonical architectural-drift failure: the test exercises the new function, not the public path that still calls the old one.

---

## A. PRODUCT THESIS VERDICT

PortProof has a defensible and narrow product boundary **after analysis**.

### What validates the thesis

1. The fixture proves the failure mode is real, not hypothetical. A clean cherry-pick passes all tests while the public behavior is still wrong. This is a measurable case that existing backport tools and CI cannot detect.

2. The differentiator is concrete: PortProof's claim is not "better AI code review." It is "a deterministic executable proof that the public behavior contract holds on the target branch through the target branch's real execution path." The proof is a command with an exit code. The verdict comes from that exit code, not from an LLM judgment.

3. The behavior proof is distinguishable from test adaptation. The critical distinction is the subject of the proof: existing tests assert properties of individual functions in isolation; the behavior proof asserts a property of the public API through the production routing path. A cherry-picked test can pass while the routing is wrong. A routing-aware public-behavior proof cannot.

### Serious weaknesses to document

**Weakness 1 — BehaviorContract extraction reliability.**
For the fixture, the contract is derived from a well-documented bug (`REQUEST_TIMEOUT_MS=0` means "disable timeout"). In real repositories the observable intent may be ambiguous, underdocumented, or spread across many commits. Bob's contract extraction can fail silently by producing a plausible but wrong contract. Mitigation: the contract is a human-reviewable artifact; the CLI supports explicit `--contract <path>` to accept a pre-written contract; when the contract is accepted by schema but may be semantically too narrow, the report emits UNVERIFIABLE with an `unverifiableReason` explaining the limitation.

**Weakness 2 — Target-native proof generation vs. test adaptation.**  
If the generated proof is just a copy of the source test with different import paths, it is not semantically different from test adaptation. The proof must always route through the public API or production code path, not through internal helpers. The architecture enforces this by requiring the proof to import from `createRequestOptions` (or the equivalent public export), never from `__internal`.

**Weakness 3 — Fixture dependency.**  
The demo depends on a specially crafted fixture. The architecture mitigates this by: (a) keeping the fixture open-source and reproducible, (b) designing the CLI to accept any target branch and any proof command, (c) targeting real open-source repositories in post-hackathon milestones.

**Weakness 4 — The word "prove" is strong.**  
PortProof does not prove correctness in the formal sense. It proves that a specific observable assertion holds on a specific execution path. The report must say exactly this. The UI must say NOT_PROVEN, not INCORRECT, and PROVEN, not CORRECT. The verdict is scoped to what was asserted.

**Weakness 5 — Lifecycle hook value.**  
A lifecycle hook that blocks commits when verdict is NOT_PROVEN is only useful if PortProof is a mandatory gate. For the hackathon MVP, this is configuration overhead for one fixture. The hook is included at Gate 9 but explicitly scoped as a demonstration of capability, not a required product feature. It earns its Bobcoin only if the demo has time for it.

**Conclusion:** The product boundary is defensible. The core thesis — deterministic behavioral proof that CI and cherry-pick cannot provide — is represented concretely in the fixture.

---

## B. FINAL ARCHITECTURE

### 1. Hackathon MVP scope (explicit cuts)

**In scope:**
- JavaScript/TypeScript repositories
- Local Git repositories already containing the target branch
- Source fix specified as a commit SHA or tag
- Target branch specified by name
- Proof command specified explicitly or adapted by Bob
- Deterministic runner: `npm test`, `node proof/...`
- Bob workflow: source investigation, target investigation, contract generation, proof adaptation, repair proposal
- CLI: `portproof verify`
- Web UI: landing, verify workspace, proof report
- Fixture: `demo-clean-backport` → NOT_PROVEN, `demo-proven-backport` → PROVEN

**Explicitly cut:**
- Automatic cherry-pick or merge — PortProof starts after the mechanical backport exists
- Conflict resolution
- GitHub API for PR/issue context (optional enrichment, not required)
- Multi-language support
- Remote repositories (clone on demand is a post-MVP feature)
- Parallel multi-branch verification
- LLM-based verdict
- CI integration beyond the proof command
- Automatic publishing, tagging, or releasing

### 2. Component and data-flow architecture

```
Source fix commit + Target branch
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 1 — Provenance                                               │
│  GitInspector                                                       │
│  Reads source commit SHA, target branch HEAD, cherry-pick status    │
│  Output: SourceFixEvidence                                          │
└────────────────────────────┬────────────────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
┌─────────────────────┐          ┌─────────────────────────────────┐
│  PHASE 2a           │          │  PHASE 2b                       │
│  Bob SourceAgent    │          │  Bob TargetAgent                │
│  (focused subagent) │          │  (focused subagent)             │
│                     │          │                                 │
│  Inspects diff,     │          │  Inspects target branch         │
│  regression test,   │          │  independently.                 │
│  surrounding code,  │          │  Identifies public API path,    │
│  PR/issue context   │          │  routing, test conventions,     │
│                     │          │  architectural differences       │
│  Output:            │          │                                 │
│  SourceAnalysis     │          │  Output: TargetAnalysis         │
└─────────┬───────────┘          └───────────────┬─────────────────┘
          │                                       │
          └──────────────┬────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 3 — BehaviorContract generation                              │
│  Bob BehaviorMapper (focused task using both analyses)              │
│                                                                     │
│  Produces structured BehaviorContract JSON artifact.                │
│  Deterministic validator performs schema check on the artifact.     │
│  If schema invalid → UNVERIFIABLE (fail-closed).                    │
│                                                                     │
│  Output: BehaviorContract (schema-validated)                        │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 4 — Proof adaptation                                         │
│  Bob ProofAdapter                                                   │
│                                                                     │
│  Uses TargetAnalysis + BehaviorContract.                            │
│  Writes or adapts a target-native ExecutableProof that exercises    │
│  the public API path, not internal helpers.                         │
│  Deterministic code validates: proof imports from public export.    │
│                                                                     │
│  Output: ExecutableProof (file path + proof command)                │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 5 — Deterministic verification                               │
│  PortProof Runner                                                   │
│  Consumes Bob-produced artifacts only after schema/integrity        │
│  validation. Bob never assigns the final verdict.                   │
│                                                                     │
│  Step A: validate BehaviorContract schema (Zod)                     │
│  Step B: validate ExecutableProof (public boundary check)           │
│  Step C: compute and record contractHash + proofHash (SHA-256)      │
│  Step D: run target existing/regression tests → ExistingTestsResult │
│  Step E: run executable proof → SemanticProofResult                 │
│  Step F: evaluate all deterministic gates (see verdict rules)       │
│  Step G: emit verdict from gate results only                        │
│                                                                     │
│  PROVEN only if ALL gates pass (see verdict rules below)            │
│  NOT_PROVEN if any gate fails but execution completed               │
│  UNVERIFIABLE if execution cannot be established                    │
│                                                                     │
└──────────┬─────────────────────────────────────┬─────────────────────┘
           │ PROVEN                               │ NOT_PROVEN
           ▼                                      ▼
┌─────────────────────┐          ┌──────────────────────────────────────┐
│  PHASE 6a           │          │  PHASE 6b — Repair                   │
│  Emit               │          │  Bob RepairAgent                     │
│  BackportProofReport│          │                                      │
│  verdict: PROVEN    │          │  Proposes minimal target-native      │
└─────────────────────┘          │  repair. Receives SemanticProofResult│
                                 │  TargetAnalysis only.                │
                                 │  Output: RepairDiff                  │
                                 │                                      │
                                 │  RepairAgent may modify target       │
                                 │  application code only. It must not  │
                                 │  modify BehaviorContract,            │
                                 │  ExecutableProof, proof assertions,  │
                                 │  or expected values.                 │
                                 │                                      │
                                 │  PortProof applies repair to         │
                                 │  isolated workspace.                 │
                                 │                                      │
                                 │  Re-run Steps D + E using the exact  │
                                 │  same frozen proofHash artifact.     │
                                 │  Verdict from gate results only.     │
                                 │                                      │
                                 │  Output: BackportProofReport         │
                                 │  with rerun history + hashes         │
                                 └──────────────────────────────────────┘
```

### Data flow summary

Bob proposes structured evidence. Deterministic code validates and executes it. Bob never assigns the final verdict.

```
GitInspector → SourceFixEvidence
Bob(SourceAgent) ← SourceFixEvidence → SourceAnalysis (artifact file)
Bob(TargetAgent) ← SourceFixEvidence → TargetAnalysis (artifact file)
Bob(BehaviorMapper) ← SourceAnalysis + TargetAnalysis → BehaviorContract (artifact file)
Runner.validate ← BehaviorContract → schema-valid or UNVERIFIABLE
Bob(ProofAdapter) ← BehaviorContract + TargetAnalysis → ExecutableProof (artifact file)
Runner.validate ← ExecutableProof → public-boundary-valid or UNVERIFIABLE
Runner.hash ← BehaviorContract + proof file → contractHash + proofHash (frozen)
Runner ← target branch → ExistingTestsResult
Runner ← ExecutableProof (frozen) → SemanticProofResult
Runner ← all gate results → verdict (PROVEN / NOT_PROVEN / UNVERIFIABLE)
Bob(RepairAgent) ← SemanticProofResult + TargetAnalysis → RepairDiff (only if NOT_PROVEN)
  RepairAgent: modifies target application code only, never contract or proof
Runner ← RepairDiff → apply to workspace
Runner ← ExecutableProof (same proofHash) → SemanticProofResult (rerun)
Reporter ← all artifacts + hashes → BackportProofReport (JSON + text)
```

---

## C. CONTRACT DEFINITIONS

### SourceFixEvidence

```typescript
interface SourceFixEvidence {
  sourceCommit: string;           // full SHA of the source fix commit
  sourceBranch: string;           // branch the fix came from
  targetBranch: string;           // branch being verified
  targetCommit: string;           // HEAD SHA of target branch at run time
  cherryPickStatus: "CLEAN" | "CONFLICT" | "NOT_APPLIED" | "UNKNOWN";
  diffStats: {
    filesChanged: string[];       // paths changed in source fix
    insertions: number;
    deletions: number;
  };
  sourceTestFiles: string[];      // test files touched or near the source fix
  rawDiff: string;                // full unified diff text
}
```

**Owner:** deterministic `GitInspector` module — no AI.  
**Fail-closed:** if the target branch or source commit cannot be resolved, abort with UNVERIFIABLE before any Bob task runs.

---

### SourceAnalysis

```typescript
interface SourceAnalysis {
  intent: string;                 // human-readable statement of the observable intent
  affectedPublicApi: string[];    // public export names implicated
  sourceImplementationPath: string[];  // file paths on source branch
  sourceTestEvidence: string[];   // test files and assertion descriptions
  regressionTestPresent: boolean;
  contextNotes: string;           // additional reasoning (free text, for human audit)
  producedBy: "bob-source-agent"; // provenance marker, never omitted
}
```

**Owner:** Bob SourceAgent subagent.  
**Artifact location:** `.portproof/runs/<runId>/source-analysis.json`

---

### TargetAnalysis

```typescript
interface TargetAnalysis {
  targetPublicApiPath: string[];   // file paths that own the public API on target
  routingPath: string[];           // execution path from public API to implementation
  legacyFunctionNames: string[];   // functions still active on the target public path
  testConventions: string;         // how tests are structured and run on this branch
  architecturalDifferences: string; // known divergence from source branch
  targetTestFiles: string[];
  producedBy: "bob-target-agent";
}
```

**Owner:** Bob TargetAgent subagent. Runs independently of SourceAgent — it must not receive SourceAnalysis as input. This prevents the agent from just mirroring source structure onto the target.  
**Artifact location:** `.portproof/runs/<runId>/target-analysis.json`

---

### BehaviorContract

```typescript
interface BehaviorContract {
  id: string;                     // slug, e.g. "request-timeout-zero-disables-timeout"
  version: "1";
  source: {
    commit: string;
    branch: string;
  };
  target: {
    branch: string;
    commit: string;
  };
  intent: string;                 // one sentence, imperative mood
  observable: {
    setup: Record<string, string>;     // environment or config to establish
    operation: string;                 // what public API call is made
    expected: Record<string, unknown>; // the asserted result
  };
  evidence: {
    sourceFiles: string[];
    sourceTests: string[];
    targetFiles: string[];
  };
  producedBy: "bob-behavior-mapper";
  schemaVersion: "portproof/behavior-contract/v1";
}
```

**Owner:** Bob BehaviorMapper for production; deterministic schema validator for gating.  
**Schema enforcement:** Zod schema must pass before the contract is used. Invalid → UNVERIFIABLE.  
**Explicit constraint on `observable.operation`:** must describe a call through the public API, not an internal function.  
**Artifact location:** `.portproof/runs/<runId>/behavior-contract.json`

---

### TargetMapping

```typescript
interface TargetMapping {
  sourceImplementationPath: string[];   // from SourceAnalysis
  targetImplementationPath: string[];   // from TargetAnalysis
  routingGap: string;                   // description of where source and target diverge
  proofEntryPoint: string;              // the public export the proof should import from
  proofFilePath: string;                // where proof will be written
  producedBy: "bob-behavior-mapper" | "bob-proof-adapter";
}
```

**Owner:** Bob BehaviorMapper (initial) + ProofAdapter (refined).  
**Artifact location:** `.portproof/runs/<runId>/target-mapping.json`

---

### ExecutableProof

```typescript
interface ExecutableProof {
  proofFilePath: string;          // relative path in the target workspace
  proofCommand: string;           // exact shell command, e.g. "node proof/..."
  contractId: string;             // which BehaviorContract this proves
  publicBoundary: {
    module: string;               // e.g. "../src/request.js"
    export: string;               // e.g. "createRequestOptions"
  };
  expectedValue: unknown;         // serializable
  setupEnv: Record<string, string>;
  producedBy: "bob-proof-adapter" | "fixture-static";
}
```

**Owner:** Bob ProofAdapter writes the descriptor; deterministic code validates it before the proof runs.
**Constraint (JS/TS MVP):** the deterministic validator reads the proof file's import declarations and confirms that the imported module and exported name match `publicBoundary`. It rejects any import containing `__internal`, `_private`, or any symbol not present in the declared module's public exports. This validation is scoped to JavaScript/TypeScript static import analysis; it does not claim to establish universal public-API correctness across arbitrary languages.
Violation → UNVERIFIABLE.
**Artifact location:** `.portproof/runs/<runId>/executable-proof.json` (descriptor) + actual proof file

---

### ProofIntegrityRecord

Computed and recorded by the runner before the first semantic proof execution. Immutable once written.

```typescript
interface ProofIntegrityRecord {
  contractHash: string;    // SHA-256 hex of behavior-contract.json at proof-start time
  proofHash: string;       // SHA-256 hex of the proof file at proof-start time
  frozenAt: string;        // ISO timestamp
}
```

**Owner:** deterministic runner only. Written to `.portproof/runs/<runId>/proof-integrity.json`.
**Immutability rule:** after `frozenAt` is written, any modification to `behavior-contract.json` or the proof file causes the runner to abort the reverification with UNVERIFIABLE rather than proceeding with a hash mismatch.

---

### ExistingTestsResult

```typescript
interface ExistingTestsResult {
  command: string;         // e.g. "npm test"
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  passed: boolean;         // exitCode === 0
  runAt: string;
}
```

**Owner:** deterministic runner only.

---

### SemanticProofResult

```typescript
interface SemanticProofResult {
  contractId: string;
  proofHash: string;       // must match ProofIntegrityRecord.proofHash
  proofCommand: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  expectedValue: unknown;
  observedValue: unknown | null;   // parsed from stdout when available
  assertionLine: string | null;    // failed assertion message if exit != 0
  passed: boolean;                 // exitCode === 0
  runAt: string;
}
```

**Owner:** deterministic runner only. No AI may produce or modify this object.
**`passed` rule:** `exitCode === 0` → `true`. Any other exit code → `false`.

---

### Verdict rules (deterministic, no exceptions)

```
PROVEN requires all of the following:
  1. BehaviorContract passes Zod schema validation
  2. ExecutableProof publicBoundary validation passes
  3. ProofIntegrityRecord written (contractHash + proofHash recorded)
  4. ExistingTestsResult.passed === true
  5. SemanticProofResult.passed === true
  6. SemanticProofResult.proofHash === ProofIntegrityRecord.proofHash

NOT_PROVEN when:
  - Any of gates 1–3 pass (execution reached) AND
  - gate 4 OR gate 5 fails AND
  - no execution error prevented running

UNVERIFIABLE when:
  - Gate 1 fails (schema invalid)
  - Gate 2 fails (public boundary violation)
  - The proof file does not exist
  - The proof command is not found (ENOENT)
  - The proof command exits with a signal (SIGKILL, timeout)
  - ProofIntegrityRecord cannot be written
  - proofHash mismatch on reverification
  - SourceAgent or TargetAgent produces malformed JSON
  - Git operations fail (target branch not found, source commit not found)
```

A semantic proof result of `passed === true` cannot produce PROVEN if `ExistingTestsResult.passed === false`. Both gates must pass.

---

### BackportProofReport (final artifact)

```typescript
interface BackportProofReport {
  id: string;
  scenario: string;
  createdAt: string;
  // Provenance
  source: { commit: string; branch: string; };
  target: { branch: string; commit: string; };
  // Mechanical
  mechanical: {
    cherryPickStatus: "CLEAN" | "CONFLICT" | "NOT_APPLIED" | "UNKNOWN";
    existingTests: ExistingTestsResult;
  };
  // Semantic
  contract: BehaviorContract;
  mapping: TargetMapping;
  // Proof integrity (frozen before first semantic run)
  integrity: ProofIntegrityRecord;
  // Evidence from Bob (investigation artifacts, not verdict inputs)
  bobEvidence: {
    sourceAnalysis: SourceAnalysis;
    targetAnalysis: TargetAnalysis;
  };
  // Deterministic proof
  proof: {
    executable: ExecutableProof;
    initialRun: SemanticProofResult;
  };
  // Repair if applied
  repair?: {
    diff: string;
    summary: string;
    proposedBy: "bob-repair-agent";
    // Each rerun records the proofHash it used, proving same artifact
    reruns: SemanticProofResult[];
  };
  // Final deterministic verdict
  verdict: "PROVEN" | "NOT_PROVEN" | "UNVERIFIABLE";
}
```

**Owner:** deterministic reporter assembles from all artifacts. Verdict is derived from the deterministic gate evaluation, not from any Bob artifact.
**Audit guarantee:** `integrity.proofHash` must equal every `SemanticProofResult.proofHash` in `proof.initialRun` and `repair.reruns`. A reader of this report can verify that the same proof file was used before and after repair by comparing these hashes.

**Note on `NEEDS_HUMAN`:** This status is removed from the machine verdict. The three machine states — `PROVEN`, `NOT_PROVEN`, `UNVERIFIABLE` — cover all deterministic outcomes. When human review is warranted (e.g., the contract was accepted by schema but may be semantically incomplete), the report carries an `unverifiableReason` string on the `UNVERIFIABLE` result, which the UI and CLI surface as an explanation and recommended action. This is accurate: the machine does not know what a human needs to do; it only knows what it cannot prove.

---

## D. BOB-NATIVE WORKFLOW

### Where Bob is genuinely required

| Bob task | Real workflow problem it solves | Alternative without Bob |
|---|---|---|
| SourceAgent | Interprets git diff + surrounding context to extract the observable intent | Manual reading, error-prone, not scalable |
| TargetAgent | Finds divergent execution path on old branch without assuming source architecture | Hardcoded heuristics that break on novel repos |
| BehaviorMapper | Translates two independent analyses into a structured, schema-validated contract | Free-form notes, cannot be deterministically validated |
| ProofAdapter | Writes target-native proof exercising the actual public routing path | Copying the source test (precisely the failure mode PortProof detects) |
| RepairAgent | Proposes minimal fix that touches only the diverged routing path | Showing a diff and asking the maintainer to figure it out |

### Where deterministic code is used instead

- Git operations (checkout, diff, log, cherry-pick status): `simple-git`
- Schema validation: Zod
- Command execution: `child_process.spawn` with timeout
- Verdict assignment: exit code comparison
- Proof file validation (is the import public?): static analysis
- Report assembly: TypeScript object construction
- SSE stream of events: Node.js streams
- File I/O: Node.js `fs`

### Reusable Skill — `.bob/skills/semantic-backport/`

The skill packages the full workflow so it can be invoked consistently in Bob with `use_skill semantic-backport`. It contains:

- Description of the four-agent pipeline (source, target, mapper, repair)
- Constraints on each agent (TargetAgent must not see SourceAnalysis first)
- Schema definitions for each artifact
- Required artifact paths per run
- Rules: never produce a verdict, never call the proof, never modify the runner

This skill solves a real problem: without it, each invocation of Bob for a PortProof task would require re-explaining the workflow, the contract structure, and the trust boundary.

### Custom mode — `portproof-verifier`

**Real workflow problem:** In free agent mode, Bob can run arbitrary terminal commands, push to remotes, install packages globally, or call external APIs. For a verification workflow, we want Bob to reason, read files, write proof artifacts, and propose patches — nothing else.

**Bounded permissions (`.bob/modes/portproof-verifier.yaml`):**
```yaml
id: portproof-verifier
name: PortProof Verifier
roleDefinition: >
  You are a semantic backport investigator. You inspect source and target
  branch code to extract behavioral evidence and write target-native proof
  artifacts. You do not run tests, do not commit, do not push, and do not
  declare a backport PROVEN or NOT_PROVEN. That decision belongs to the
  deterministic runner.
allowedTools:
  - read_file
  - list_files
  - glob
  - grep
  - write_file
  - apply_diff
  - insert_content
  # No: execute_command, git push, publish
```

This is not about security theater. It solves a real workflow problem: investigators who accidentally run `npm run proof` inside Bob and interpret the printed output as the verdict.

### Lifecycle hook — `portproof-gate`

**Real workflow problem:** A developer on a multi-branch project may habitually create a release PR after seeing "cherry-pick clean + tests pass." A pre-push hook that requires a PortProof PROVEN report on the release branch before push prevents the silent semantic failure from reaching production.

**Scope:** This is a developer-workstation gate, not a mandatory CI gate. For the hackathon demo, the hook is shown as a configuration option, not a required product component.

**Trigger:** `prompt` event (or `stop` event when the session ends with a backport-related command).

**Behavior:** If `.portproof/runs/latest/report.json` exists and `verdict !== "PROVEN"`, the hook writes a warning to the terminal. It does not block the push automatically in the MVP — that requires pre-push Git hook configuration documented separately.

**Decision:** Include at Gate 9. Budget 2 Bobcoins for documentation and demo only.

### Subagents and parallel investigation

**SourceAgent and TargetAgent run in parallel.** They have independent inputs:

- SourceAgent receives: `SourceFixEvidence` (diff, source files, source tests)
- TargetAgent receives: `SourceFixEvidence` (diff + target branch name only — not source code analysis)

This prevents a cross-contamination failure where the TargetAgent mirrors the source architecture rather than discovering what the target branch actually does.

**BehaviorMapper** runs after both agents complete and receives both outputs.

**ProofAdapter** runs after BehaviorMapper.

**RepairAgent** runs only if the proof fails.

Parallel investigation of source and target is genuinely valuable here — it saves wall-clock time and prevents the TargetAgent from being anchored to the SourceAgent's framing.

---

## E. DETERMINISTIC TRUST BOUNDARY

### Core principle

**Bob proposes structured evidence. Deterministic code validates and executes it. Bob never assigns the final verdict.**

The runner consumes Bob-produced artifacts — `BehaviorContract`, `TargetMapping`, and `ExecutableProof` — but only after schema and integrity validation. It never trusts Bob's narrative reasoning, claimed verdict, or free-form assessment. Those fields exist in `SourceAnalysis.contextNotes` and `TargetAnalysis.architecturalDifferences` for human audit only; they play no role in verdict computation.

### What the deterministic runner owns exclusively

1. **Schema validation** — Zod schema for `BehaviorContract`. If validation fails, no proof is attempted.
2. **Public-boundary validation** — static analysis of the proof file's imports against `ExecutableProof.publicBoundary` (JS/TS only). Violation → UNVERIFIABLE.
3. **Proof immutability** — before the first semantic proof run, computes `contractHash` (SHA-256 of `behavior-contract.json`) and `proofHash` (SHA-256 of the proof file) and writes `proof-integrity.json`. These are frozen. On any reverification, the runner recomputes and compares; a mismatch aborts with UNVERIFIABLE.
4. **Workspace isolation** — creates a temporary directory per run, copies target branch files there, never modifies the original repository.
5. **Command execution** — `child_process.spawn` with hardened options: no shell expansion (`shell: false`), explicit environment, stdout/stderr capture, wall-clock timeout (default 30s).
6. **Gate evaluation** — evaluates all six PROVEN gates in order (see verdict rules in Section C). No gate may be skipped.
7. **Assertions** — the proof file contains the assertion. The runner does not add assertions. The runner does not remove assertions.
8. **Report assembly** — the `BackportProofReport` is built from artifact files and measured results, not from Bob's narrative.
9. **Verdict** — derived from gate evaluation results only. No other code path sets the verdict.

### What Bob may never do

- Execute `npm run proof` or any test command and report the output as the verdict
- Write or modify `SemanticProofResult`, `ExistingTestsResult`, or `ProofIntegrityRecord`
- Modify `BehaviorContract` after it has been schema-validated
- Modify the proof file or proof assertions after `ProofIntegrityRecord` has been written
- Weaken an assertion or expected value to obtain an exit code of 0
- Produce a `BackportProofReport` directly

### RepairAgent immutability constraint

After a NOT_PROVEN result, `RepairAgent` may propose changes to target application code only. It must not modify:
- `BehaviorContract` (or any file that would change `contractHash`)
- The proof file (or any file that would change `proofHash`)
- Proof assertions or `expectedValue` fields in the `ExecutableProof` descriptor

Reverification always executes the same frozen proof artifact. The runner verifies `proofHash` matches before proceeding.

### Fail-closed behavior for ambiguous cases

| Situation | Verdict | Gate |
|---|---|---|
| BehaviorContract schema invalid | UNVERIFIABLE | Gate 1 |
| ExecutableProof public-boundary violation | UNVERIFIABLE | Gate 2 |
| Proof file does not exist | UNVERIFIABLE | Gate 2 |
| `ProofIntegrityRecord` cannot be written | UNVERIFIABLE | Gate 3 |
| `proofHash` mismatch on reverification | UNVERIFIABLE | Gate 6 |
| Proof command not found (ENOENT) | UNVERIFIABLE | Gate 5 |
| Proof command exits with signal (SIGKILL, timeout) | UNVERIFIABLE | Gate 5 |
| SourceAgent or TargetAgent produces malformed JSON | UNVERIFIABLE | Pre-gate |
| Git target branch does not exist | abort before any Bob task, error report | Pre-gate |
| Source commit not found | abort before any Bob task, error report | Pre-gate |
| `ExistingTestsResult.passed === false` | NOT_PROVEN | Gate 4 |
| `SemanticProofResult.passed === false` | NOT_PROVEN | Gate 5 |
| Repair breaks existing tests (rerun) | NOT_PROVEN | Gate 4 rerun |

**The UNVERIFIABLE state is not a failure of PortProof. It is honest reporting that the available evidence and execution environment were insufficient to produce a deterministic verdict. When human review may help, the report carries `unverifiableReason` with an explanation.**

---

## F. FRONTEND + DEMO ARCHITECTURE

### Route structure

| Route | Purpose | Data source |
|---|---|---|
| `/` | Landing, problem explanation, demo entry | Static example (labeled "Example") + real run API when triggered |
| `/verify?scenario=timeout-zero` | Live proof workspace with SSE progress | Real `/api/runs/:runId/events` |
| `/report/:runId` | Immutable audit report | `/api/reports/:runId` |

### Information hierarchy (enforced, not suggested)

1. **Final verdict** — dominant visual, impossible to miss
2. **Contradiction strip** — Mechanical PASS vs Semantic FAIL in two visually separated columns (never merged into one score)
3. **Behavior Contract** — human-readable fields first, raw JSON behind a toggle
4. **Source / Target mapping** — two columns, visually connected with evidence pointers
5. **Deterministic proof evidence** — exact command, exit code, observed vs expected
6. **Bob-generated investigation** — labeled as "Bob-generated analysis", evidence-backed steps
7. **Raw logs** — collapsed by default, available in drawer

**The contradiction strip is the keystone UI element.** Mechanical and semantic must be visually impossible to confuse on any viewport.

### Three-click path to NOT_PROVEN (judge path)

1. **Click 1:** Landing page → "Run the broken backport demo" → navigates to `/verify?scenario=timeout-zero`
2. **Click 2:** Verify page loads with fixture preloaded → "Run proof" button → SSE stream begins
3. **Verdict appears:** `NOT_PROVEN` with evidence (expected 0, observed 5000)

The contradiction is reached without entering credentials, without installing anything, without choosing a branch.

### Demo repair flow (two additional clicks)

4. **Click 3:** "Apply target-native repair" → server applies real patch, reruns tests + proof
5. **Verdict changes to PROVEN** (only because exit code changed)

The repair button never turns the UI green by itself. The verdict change is gated on real execution.

### SSE event types and their UI effects

```
run.started          → spinner appears, verdict strip shows RUNNING
mechanical.started   → Mechanical section enters RUNNING state
mechanical.completed → Cherry-pick: CLEAN card animates in
tests.started        → Existing tests enter RUNNING
tests.completed      → Existing tests: PASS 3/3 appears
contract.loaded      → BehaviorContract card reveals
proof.started        → Proof runner section enters RUNNING
proof.completed      → Observed value appears, exit code appears
verdict.completed    → Dominant verdict strip updates to NOT_PROVEN, PROVEN, or UNVERIFIABLE
repair.applied       → RepairPanel shows diff, run transitions to REVERIFY
reverify.completed   → Verdict strip updates to PROVEN or NOT_PROVEN
run.failed           → Error state (UNVERIFIABLE), logs exposed
```

Animations reveal state; they never precede it.

### Bob honesty labeling

Every Bob-generated artifact displayed in the UI must carry a label:

```
┌─────────────────────────────────────────┐
│  Bob-generated analysis                 │
│  Source investigator                    │
│  Identified public behavior path and    │
│  source regression evidence.            │
│  → src/request.js  → test/request.test  │
└─────────────────────────────────────────┘
```

Alongside it, deterministic evidence:

```
┌─────────────────────────────────────────┐
│  Deterministic verification             │
│  node proof/public-behavior-proof.js    │
│  exit 1  184ms                          │
│  expected: 0  observed: 5000            │
└─────────────────────────────────────────┘
```

These two panels must never share a container that implies they are the same kind of evidence.

### Landing page data policy

- Hero contradiction card: rendered immediately from a static object, visibly labeled "Demo scenario"
- No real run starts until the user clicks CTA
- Every status on `/verify` comes from the real run API after that click
- Timing values, exit codes, observed values are never fabricated

---

## G. BUILD ORDER AND ACCEPTANCE GATES

### Gate 0: Evidence (done — fixture verified)

- `demo-clean-backport` → `npm test` PASS, `npm run proof` FAIL ✓
- `demo-proven-backport` → `npm test` PASS, `npm run proof` PASS ✓
- Root cause documented: routing through `parseLegacyTimeout` vs `parseModernTimeout` ✓

**Acceptance:** fixture is read-only from this point. No modifications permitted.

### Gate 1: Deterministic CLI

Build `portproof verify` with explicit proof command:

```sh
portproof verify \
  --source 49bbeb3 \
  --target demo-clean-backport \
  --proof "node proof/public-behavior-proof.js" \
  --repo ./fixture
```

Expected: `NOT_PROVEN`, JSON report written.

```sh
portproof verify \
  --source 49bbeb3 \
  --target demo-proven-backport \
  --proof "node proof/public-behavior-proof.js" \
  --repo ./fixture
```

Expected: `PROVEN`, JSON report written.

**Acceptance:** both commands produce correct verdicts. No Bob required. Tests: two integration tests against fixture branches.

### Gate 2: Structured report

Emit `BackportProofReport` JSON and human-readable terminal summary.  
Fields: source commit, target branch/commit, cherry-pick status, existing test result, proof command, exit code, observed value, expected value, verdict.

**Acceptance:** `jq .verdict` returns `"PROVEN"` / `"NOT_PROVEN"`. Schema test passes.

### Gate 3: BehaviorContract schema

Implement Zod schema for `BehaviorContract`. Add `--contract <path>` CLI flag.  
Add malformed-contract tests: missing `observable.expected`, wrong schema version, empty `intent`.

**Acceptance:** all malformed contract cases produce `UNVERIFIABLE`. Valid contract accepted.

### Gate 4: Bob source + target analysis

Run SourceAgent and TargetAgent as focused Bob tasks against the fixture.  
Artifacts written to `.portproof/runs/<runId>/source-analysis.json` and `target-analysis.json`.  
TargetAgent correctly identifies `parseLegacyTimeout` as the routing problem.

**Acceptance:** both artifacts conform to their schemas. TargetAnalysis names the routing gap.

### Gate 5: Target-native proof adaptation

Bob ProofAdapter reads TargetAnalysis + BehaviorContract and writes a proof that imports from `createRequestOptions`, not `__internal.parseModernTimeout`.  
Proof fails on `demo-clean-backport`, passes on `demo-proven-backport`.

**Acceptance:** the Bob-adapted proof produces the same verdict as the static fixture proof.

### Gate 6: Repair loop

Bob RepairAgent proposes a patch that routes `createRequestOptions` through `parseModernTimeout`.  
Runner applies the patch, reruns existing tests (must still pass), reruns proof.  
Report includes repair diff and rerun history.

**Acceptance:** applying the repair to the clean-backport fixture produces PROVEN with both tests and proof passing.

### Gate 7: Bob Skill

Package workflow as `.bob/skills/semantic-backport/SKILL.md`.  
Covers all four agents, artifact paths, schema references, trust boundary rules.

**Acceptance:** a new Bob session can invoke the skill and produce valid artifacts without re-explaining the workflow.

### Gate 8: Bounded custom mode

Create `.bob/modes/portproof-verifier.yaml` with read/write-file and glob/grep only.  
No execute_command, no push.

**Acceptance:** mode is loadable in Bob. Attempting to run a terminal command in this mode is blocked.

### Gate 9: Lifecycle hook (optional demo)

Document pre-push hook configuration.  
Demo hook reads `.portproof/runs/latest/report.json` and warns on NOT_PROVEN.

**Acceptance:** hook outputs warning when verdict is NOT_PROVEN. Not required for demo main path.

### Gate 10: Web UI

Build React + Vite + Express application.  
Routes: `/`, `/verify`, `/report/:runId`.  
SSE-driven verify workspace.  
Landing hero shows contradiction card labeled "Demo scenario."

**Acceptance:**
- Judge reaches NOT_PROVEN in three clicks on the fixture
- Mechanical PASS and semantic FAIL are visually impossible to confuse
- Repair button only turns the verdict to PROVEN after real reruns pass
- Report page opens by URL without rerunning

### Gate 11: Submission evidence

- `bob_sessions/` — screenshots from Gates 4, 5, 6, 7
- `README.md` — architecture, demo, fixture instructions
- Architecture diagram
- `v1.0-hackathon` tag (immutable after submission)
- Source list for any public data used

---

## H. BOBCOIN BUDGET

Total available: **40 Bobcoins**

| Task | Gate | Bob Role | Bobcoins | Justification |
|---|---|---|---|---|
| SourceAgent — inspect diff, extract intent | 4 | Source investigator | 4 | Focused, bounded: diff + source files only |
| TargetAgent — inspect target branch architecture | 4 | Target investigator | 4 | Focused, bounded: target files only |
| BehaviorMapper — produce BehaviorContract from both analyses | 4 | Behavior contract author | 3 | Inputs are pre-structured; output is schema-validated |
| ProofAdapter — write target-native proof | 5 | Proof author | 4 | Must understand routing gap; proof must import from public API |
| RepairAgent — propose minimal repair | 6 | Repair proposer | 4 | Minimal scope: one routing change |
| Skill authoring — write SKILL.md | 7 | Skill author | 3 | One-time structured document |
| Custom mode authoring | 8 | Mode author | 2 | YAML configuration + test |
| Lifecycle hook documentation | 9 | Hook documenter | 2 | Demo documentation |
| Architecture plan and design (this document) | Pre-build | Planning | 3 | This session |
| **Reserve** | All | Buffer for reruns/clarification | **11** | ~27% reserve |
| **Total** | | | **40** | |

**Notes:**
- Gates 1, 2, 3, 10, 11 require no Bobcoins (deterministic code, UI, submission).
- RepairAgent budget assumes the repair is one routing change. If the repair requires understanding a deeper divergence, it may consume up to 2 additional Bobcoins from reserve.
- The reserve covers: schema correction if BehaviorMapper produces an invalid contract, ProofAdapter reruns if the first proof is wrong, and any clarifying investigation tasks.

---

## I. RISKS AND REQUIRED VALIDATIONS

### Risk 1 — BehaviorContract extraction is too vague

**Challenge:** Bob's `intent` and `observable` fields may be plausible-sounding but wrong. A contract with the wrong `expected` value would produce a fake PROVEN on an actually broken backport.

**Mitigation:**
1. The contract is a human-reviewable JSON file, not a hidden internal state.
2. The `--contract <path>` CLI flag allows a maintainer to supply a manually verified contract.
3. The Zod schema enforces structure but cannot enforce semantic correctness. This limitation is stated explicitly in the report.
4. The fixture provides a ground truth: the correct contract has `expected.timeoutMs: 0`. If Bob produces `expected.timeoutMs: 5000`, the proof would incorrectly pass on the clean-backport. This is caught in Gate 4 acceptance testing.

**Required validation:** Gate 4 acceptance test must verify that the Bob-generated contract matches the fixture contract's `observable.expected` field exactly.

### Risk 2 — Target-native proof is indistinguishable from test adaptation

**Challenge:** If Bob writes `assert.equal(parseModernTimeout({REQUEST_TIMEOUT_MS:'0'}), 0)`, it exercises the internal helper, not the public path. This proof passes on both demo-clean-backport and demo-proven-backport, making it useless.

**Mitigation:**
1. The `ExecutableProof.publicApiImport` field is validated by deterministic code to confirm it imports from the public export (e.g., `createRequestOptions`), not from `__internal`.
2. Gate 5 acceptance test: the Bob-adapted proof must fail on `demo-clean-backport`. If it passes on both branches, the proof is wrong and Gate 5 fails.
3. The SKILL.md explicitly instructs ProofAdapter to import from the public export and explains why.

**Required validation:** The runner validates `publicApiImport` before executing the proof. Violation → UNVERIFIABLE.

### Risk 3 — Product depends too much on specially prepared fixtures

**Challenge:** The demo works because the fixture is carefully engineered. A real repository may have a less clear routing gap, making Bob's analysis unreliable.

**Mitigation:**
1. The MVP scope is honest: "JavaScript/TypeScript repositories with a deterministic public-behavior proof." Repositories where the proof cannot be determined are UNVERIFIABLE.
2. The `--proof <command>` CLI flag means a maintainer can supply a proof manually, reducing dependency on Bob's proof adaptation.
3. For the hackathon, the fixture is sufficient. Post-MVP validation against a real repository (e.g., an express.js or node-http-parser historical bug) is listed as a required post-hackathon validation.

**Required post-hackathon validation:** Test against one real open-source repository backport that is known to have a semantic gap. This tests whether the system generalizes.

### Risk 4 — The word "prove" is too strong

**Challenge:** PortProof's PROVEN verdict may be misread as a guarantee of correctness, not a guarantee of one assertion.

**Mitigation:**
1. The UI and report both state: "The target branch demonstrates the source fix's intended behavior through its real public path." Not "this backport is correct."
2. The verdict name PROVEN is scoped: it proves the BehaviorContract, not general correctness.
3. When the observable assertion may be too narrow, the report emits UNVERIFIABLE with `unverifiableReason` explaining the scope limitation — the machine does not know what a human needs to do, only what it cannot prove.
4. The Backport Proof Report includes the exact proof command and assertion text, making the scope of the proof auditable.

### Risk 5 — Lifecycle hook adds complexity without value

**Challenge:** A pre-push hook that warns about NOT_PROVEN requires each developer to configure it. If it is not universally adopted, it adds no protection.

**Assessment:** The lifecycle hook does not add real workflow protection in the MVP. Its value is demonstrating Bob's hook capability for the hackathon judges. It is included at Gate 9 as an optional demonstration, not a required product feature.

**Decision:** allocate 2 Bobcoins for documentation and a 30-second demo mention. Do not build automated pre-push enforcement in the MVP.

### Risk 6 — BehaviorMapper cross-contamination

**Challenge:** If TargetAgent receives SourceAnalysis as input, it will describe the target branch in terms of the source architecture rather than what is actually there. This would produce a correct-sounding contract that fails on unfamiliar repositories.

**Mitigation:** Architecture rule enforced in SKILL.md and mode config: TargetAgent receives only `SourceFixEvidence.diffStats` and `targetBranch` as context. It must discover the target architecture independently.

### Risk 7 — UI states are faked during repair

**Challenge:** If the repair button sets a UI flag to PROVEN without re-executing, the entire trust model breaks.

**Mitigation:**
1. `POST /api/runs/:runId/repair` is a server-side operation that applies the patch and reruns tests and the semantic proof.
2. The verdict on the report page is derived from gate evaluation results in the runner, not from a UI flag.
3. The runner verifies `proofHash` matches `ProofIntegrityRecord.proofHash` before reverification; a mismatch produces UNVERIFIABLE, not PROVEN.
4. Frontend acceptance criterion 5: `Apply target-native repair` changes the verdict only after real reruns pass all gates.

---

## J. ARCHITECTURE DECISION RECORD

### Why this design is more defensible than a generic AI backport bot

**Generic AI backport bot:**
- Selects commits to backport
- Resolves conflicts using LLM suggestions
- Runs existing CI
- Declares "looks good" if CI passes or LLM rates the diff highly
- The verdict is based on AI confidence

**PortProof:**
- Starts after the mechanical backport already exists (explicit non-overlap)
- The verdict is based on a process exit code from a deterministic command
- Bob's role is investigation and artifact generation, not verdict assignment
- The key failure mode — cherry-pick clean, tests pass, behavior wrong — is detected by a public-behavior proof that existing CI does not run
- The trust boundary is enforced architecturally: the runner consumes Bob-produced structured artifacts only after schema and integrity validation; it never acts on Bob's narrative reasoning or claimed verdict

**Why this matters for the hackathon judging criteria:**

| Criterion | How this design addresses it |
|---|---|
| Application of Technology | Bob is used across five distinct reasoning tasks, not just code generation. The custom mode and skill demonstrate native IBM Bob features. |
| Presentation | The three-click path to NOT_PROVEN is the demo. The contradiction (CLEAN + PASS + NOT_PROVEN) is the entire product argument. |
| Business Value | The problem is real and measurable: silent semantic backport failures in multi-branch open-source projects. The cost is a bug that survives into an older release. |
| Originality | The specific combination of behavioral intent extraction, target-native proof generation, and deterministic verdict is not offered by existing backport tools. |

**The product boundary is original not because AI is involved, but because the product solves the specific gap between "the patch moved" and "the behavior moved." No existing tool makes this distinction verifiable.**

---

## Sub-tasks for implementation (ordered by gate)

Each sub-task is independent and processable by a single implementation session.

### Sub-task 1 — Core types and schema [ ] pending
**Intent:** Define all TypeScript interfaces and Zod schemas for the revised contract set: `SourceFixEvidence`, `SourceAnalysis`, `TargetAnalysis`, `BehaviorContract`, `TargetMapping`, `ExecutableProof`, `ProofIntegrityRecord`, `ExistingTestsResult`, `SemanticProofResult`, `BackportProofReport`.
**Expected outcome:** `src/shared/types.ts` and `src/core/contract/schema.ts` with passing schema tests. Malformed contract cases produce UNVERIFIABLE. Verdict type is `"PROVEN" | "NOT_PROVEN" | "UNVERIFIABLE"` — no NEEDS_HUMAN.
**Relevant files:** `src/shared/types.ts`, `src/core/contract/`
**Gate:** 2 (dependency for all subsequent gates)

### Sub-task 2 — GitInspector module [ ] pending
**Intent:** Deterministic module that reads source commit, target branch HEAD, cherry-pick status, and diff without AI.  
**Expected outcome:** `src/core/git/inspector.ts` producing `SourceFixEvidence`. Integration test against fixture.  
**Gate:** 1

### Sub-task 3 — Proof runner [ ] pending
**Intent:** Deterministic module that: (a) validates `ExecutableProof.publicBoundary` against proof file imports, (b) computes and writes `ProofIntegrityRecord`, (c) runs existing tests → `ExistingTestsResult`, (d) runs proof command → `SemanticProofResult`, (e) evaluates all six PROVEN gates, (f) returns final verdict. On reverification, verifies `proofHash` before running.
**Expected outcome:** runner produces NOT_PROVEN on `demo-clean-backport`, PROVEN on `demo-proven-backport`. Modifying the proof file after hashing → UNVERIFIABLE.
**Gate:** 1–3

### Sub-task 4 — CLI entry point [ ] pending
**Intent:** `portproof verify` command wiring all deterministic modules.  
**Expected outcome:** Both fixture branches produce correct verdicts from CLI.  
**Gate:** 1

### Sub-task 5 — Structured report emitter [ ] pending
**Intent:** Assemble `BackportProofReport` JSON from artifacts. Write to `.portproof/runs/<runId>/report.json`.  
**Expected outcome:** `jq .verdict` returns correct value. Schema test passes.  
**Gate:** 2

### Sub-task 6 — BehaviorContract schema and validation [ ] pending
**Intent:** Zod schema, `--contract <path>` CLI flag, fail-closed for malformed contracts.  
**Expected outcome:** malformed contract cases produce UNVERIFIABLE, valid contract accepted.  
**Gate:** 3

### Sub-task 7 — Bob SourceAgent and TargetAgent (Bob task) [ ] pending
**Intent:** Run focused Bob tasks for source and target analysis against the fixture.  
**Expected outcome:** both analysis artifacts written, conforming to schemas.  
**Gate:** 4 (requires Gates 1–3)

### Sub-task 8 — BehaviorMapper and ProofAdapter (Bob task) [ ] pending
**Intent:** Bob produces BehaviorContract and target-native proof from analyses.  
**Expected outcome:** proof fails on clean-backport, passes on proven-backport.  
**Gate:** 5

### Sub-task 9 — RepairAgent (Bob task) [ ] pending
**Intent:** Bob proposes minimal repair patch. Runner applies and reruns.  
**Expected outcome:** clean-backport with repair applied achieves PROVEN.  
**Gate:** 6

### Sub-task 10 — Bob Skill and custom mode [ ] pending
**Intent:** Package workflow as SKILL.md and portproof-verifier mode YAML.  
**Gate:** 7–8

### Sub-task 11 — Express server and SSE events [ ] pending
**Intent:** Backend API (`/api/runs`, `/api/runs/:runId/events`, `/api/reports/:runId`).  
**Gate:** 10

### Sub-task 12 — React frontend [ ] pending
**Intent:** Landing, Verify, Report pages per `FRONTEND_ARCHITECTURE.md`.  
**Gate:** 10

### Sub-task 13 — Lifecycle hook documentation [ ] pending
**Intent:** Document and demo the pre-push hook.  
**Gate:** 9

### Sub-task 14 — Submission evidence and tag [ ] pending
**Intent:** `bob_sessions/`, README, architecture diagram, `v1.0-hackathon` tag.  
**Gate:** 11

---

## K. REVISION SUMMARY — What changed and whether these corrections weaken the thesis

### Changes made

**1. Trust-boundary wording corrected (Section B data flow, Section E)**  
Previous text said "the runner does not receive Bob's analysis as input." This was imprecise — the runner must receive `BehaviorContract`, `TargetMapping`, and `ExecutableProof` to do its job. The corrected principle is: *Bob proposes structured evidence. Deterministic code validates and executes it. Bob never assigns the final verdict.* The runner now explicitly validates Bob-produced artifacts (schema check, public-boundary check, hash verification) before consuming them, and never acts on Bob's narrative reasoning or claimed verdict. This is a clarification, not a policy change.

**2. Proof immutability added (Section C, Section E)**  
New: `ProofIntegrityRecord` with `contractHash` and `proofHash` (SHA-256) computed before the first semantic proof run and frozen. Any modification to the contract or proof file after this point causes the runner to abort with UNVERIFIABLE on reverification. `RepairAgent` may modify target application code only — never the contract, proof file, proof assertions, or `expectedValue`. `BackportProofReport` now includes `integrity: ProofIntegrityRecord`. Every `SemanticProofResult` in the report carries its `proofHash`, enabling an auditor to verify that pre-repair and post-repair runs used the same proof artifact.

**3. Final verdict semantics corrected (Section C verdict rules, Section E fail-closed table)**  
PROVEN now requires all six gates to pass in order: schema valid, public-boundary valid, `ProofIntegrityRecord` written, existing tests pass, semantic proof passes, `proofHash` matches. A semantic proof that passes cannot produce PROVEN if existing tests fail. NOT_PROVEN is the verdict when execution completes but at least one of gates 4–5 fails. UNVERIFIABLE is reserved for cases where execution cannot be established (schema invalid, file not found, signal, hash mismatch). The fail-closed table now identifies which gate maps to which situation.

**4. Status vocabulary standardized to three states (throughout)**  
`NEEDS_HUMAN` is removed as a machine verdict. It had no distinct deterministic condition that would cause the runner to emit it differently from UNVERIFIABLE. It is replaced by: UNVERIFIABLE with an `unverifiableReason` string that the UI and CLI surface as an explanation and recommended action. This makes the verdict set smaller, more precise, and auditable. The three states — PROVEN, NOT_PROVEN, UNVERIFIABLE — cover every deterministic outcome.

**5. Public-boundary validation scoped honestly to JS/TS MVP (Section C ExecutableProof)**  
`publicApiImport: string` replaced by `publicBoundary: { module: string; export: string }`. The deterministic validator performs static import analysis on the proof file against this declared boundary. The constraint is explicitly scoped to JavaScript/TypeScript static import analysis in the MVP. No claim is made about universal public-API correctness across arbitrary languages.

**6. `BackportProofReport` updated (Section C)**  
Added: `integrity: ProofIntegrityRecord`, `mechanical.existingTests: ExistingTestsResult` (renamed from `existingTestsResult: CheckResult` and given its own concrete type), `proof.initialRun: SemanticProofResult` (renamed from `proof.result: ProofResult`), `repair.reruns: SemanticProofResult[]` (each carrying `proofHash`). Removed: `NEEDS_HUMAN` from verdict union. The report now provides complete audit evidence that the same proof artifact was used in all runs.

**7. ASCII diagram and data-flow summary updated (Section B)**  
Phase 5 now shows the seven runner steps explicitly (validate schema, validate boundary, hash/freeze, run existing tests, run proof, evaluate gates, emit verdict). RepairAgent now correctly receives `SemanticProofResult` (not `ProofResult`, which no longer exists as a type). Data flow summary now opens with the trust-boundary principle and explicitly labels every Bob output as `(artifact file)`.

### Do these corrections weaken the PortProof thesis?

**No. They strengthen it.**

The original trust-boundary statement ("the runner does not receive Bob's analysis") was imprecise in a way that could have been read as either too restrictive (how does the runner know what proof to run?) or too loose (is there really no validation?). The corrected principle — validated structured artifacts pass through; narrative reasoning does not — is more precise and more defensible to a judge asking "but what stops Bob from gaming the verdict?"

The proof immutability rule closes a specific attack surface that was not addressed in the original architecture: a RepairAgent that modifies the proof assertions to obtain a passing exit code. With hash freezing, this attempt produces UNVERIFIABLE rather than a fraudulent PROVEN. This makes the PROVEN verdict stronger, not weaker.

The removal of NEEDS_HUMAN removes a verdict that had no clear deterministic trigger, which is exactly the kind of vague AI-confidence-adjacent state the product thesis argues against. Replacing it with `UNVERIFIABLE + unverifiableReason` is more honest and consistent with the product's core claim that every verdict is deterministically justified.

The six-gate PROVEN condition makes the verdict harder to achieve accidentally and easier to audit — which is the correct direction for a product whose thesis is "deterministic proof."

None of the corrections change what the fixture demonstrates. `demo-clean-backport` still produces NOT_PROVEN and `demo-proven-backport` still produces PROVEN. The thesis is intact.
