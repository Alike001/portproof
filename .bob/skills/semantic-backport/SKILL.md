---
name: semantic-backport
description: >
  Teaches Bob the PortProof semantic-backport workflow. Use when verifying
  whether a backported bug fix preserves its intended observable behavior on a
  target branch. Covers source investigation, target investigation, contract
  mapping, proof adaptation, and repair — plus the trust boundaries between
  Bob and the deterministic PortProof runner.
---

# Semantic-Backport Workflow

## Purpose

PortProof answers one narrow question:

> Does the backported fix preserve the **public observable behavior** that the
> source fix intended to establish, when exercised through the **target
> branch's real execution path**?

A clean cherry-pick, passing CI, or passing existing tests do not answer this
question. A deterministic executable proof does.

---

## Fundamental invariant

**Bob proposes structured evidence. Deterministic code owns execution and
the final verdict.**

Bob never assigns PROVEN, NOT_PROVEN, or UNVERIFIABLE. Those verdicts come
exclusively from PortProof runner gate results.

---

## Phases and Bob roles

### Phase 1 — Provenance (deterministic, no Bob)

`GitInspector` produces `SourceFixEvidence`:

```
sourceCommit, sourceBranch, targetBranch, targetCommit,
cherryPickStatus, diffStats, sourceTestFiles, rawDiff
```

Fail-closed: if the source commit or target branch cannot be resolved, abort
with UNVERIFIABLE before any Bob task runs.

---

### Phase 2a — Source investigation (`bob-source-agent`)

**Input:** `SourceFixEvidence` only.

**Goal:** establish *why* the fix was made and what observable behavior it
intended to guarantee.

**Produce `SourceAnalysis`:**

| Field | Requirement |
|---|---|
| `intent` | One sentence, imperative mood, observable behavior only |
| `affectedPublicApi` | Public export names implicated by the fix |
| `sourceImplementationPath` | File paths on the source branch |
| `sourceTestEvidence` | Test files + assertion descriptions |
| `regressionTestPresent` | Boolean |
| `contextNotes` | Free text for human audit |
| `producedBy` | Must be `"bob-source-agent"` |

**Key discipline:**
- State the *observable* intent, not just what lines changed.
- Note regression-test limitations explicitly (e.g., "test exercises helper
  directly, not through public entry point").
- Do **not** inspect the target branch.

**Artifact:** `.portproof/runs/<runId>/source-analysis.json`

---

### Phase 2b — Target investigation (`bob-target-agent`)

**Input:** `SourceFixEvidence` only. **Must not receive `SourceAnalysis`.**

Receiving `SourceAnalysis` risks anchoring the agent to source structure. The
target may have diverged architecturally. The agent must characterize the
target as it actually is, not as a mirror of the source.

**Goal:** characterize the target branch's current architecture, routing, and
test conventions independently.

**Produce `TargetAnalysis`:**

| Field | Requirement |
|---|---|
| `targetPublicApiPath` | File paths owning the public API on target |
| `routingPath` | Execution path from public API to implementation |
| `legacyFunctionNames` | Functions still active on the target public path |
| `testConventions` | How tests are structured and run on this branch |
| `architecturalDifferences` | Known divergence from source (inferred from the diff) |
| `targetTestFiles` | Test file paths |
| `producedBy` | Must be `"bob-target-agent"` |

**Key discipline:**
- Follow the actual call chain from the public export to the implementation.
- Identify which functions are on the *live routing path* vs. defined but
  unreachable from the public API.
- Do **not** assume the target uses the same helper names or structure as the
  source.

**Artifact:** `.portproof/runs/<runId>/target-analysis.json`

---

### Phase 3 — Contract mapping (`bob-behavior-mapper`)

**Input:** `SourceAnalysis` + `TargetAnalysis`.

**Produce two artifacts:**

#### 3a. `BehaviorContract`

```typescript
{
  id: string;                  // slug, kebab-case
  version: "1";
  source: { commit: string; branch: string; };
  target: { branch: string; commit: string; };
  intent: string;              // imperative, one sentence
  observable: {
    setup: Record<string, string>;    // env/config to establish
    operation: string;                // which public API is called
    expected: Record<string, unknown>; // asserted result
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

**`observable.operation` must describe a call through the declared public
API, not an internal function.** The PortProof runner validates this before
executing any proof.

Schema validation is performed by Zod in the runner. If it fails →
UNVERIFIABLE (fail-closed).

**Artifact:** `.portproof/runs/<runId>/behavior-contract.json`

#### 3b. `TargetMapping`

```typescript
{
  sourceImplementationPath: string[];
  targetImplementationPath: string[];
  routingGap: string;          // where source and target diverge
  proofEntryPoint: string;     // public export the proof imports from
  proofFilePath: string;       // where proof will be written
  producedBy: "bob-behavior-mapper";
}
```

**Artifact:** `.portproof/runs/<runId>/target-mapping.json`

---

### Phase 4 — Proof adaptation (`bob-proof-adapter`)

**Input:** `BehaviorContract` + `TargetAnalysis`.

**Goal:** produce a target-native executable proof that exercises the public
API through the target's actual routing path.

**Produce `ExecutableProof` descriptor:**

```typescript
{
  proofFilePath: string;       // relative path in target workspace
  proofCommand: string;        // exact shell command
  contractId: string;          // must match BehaviorContract.id
  publicBoundary: {
    module: string;            // import source (e.g. "../src/index.js")
    export: string;            // named export (e.g. "myPublicFunction")
  };
  expectedValue: unknown;      // serializable, must match contract expected
  setupEnv: Record<string, string>;
  producedBy: "bob-proof-adapter";
}
```

**Artifact:** `.portproof/runs/<runId>/executable-proof.json`

The runner validates that the proof file's import declarations match
`publicBoundary.module` and `publicBoundary.export`. Any import containing
`__internal`, `_private`, or a symbol absent from the module's declared
exports causes the runner to abort with UNVERIFIABLE.

**Proof authoring rules — Bob must follow all of these:**

| Rule | Rationale |
|---|---|
| Import from the public module and named export only | Ensures routing path is exercised |
| Do not import `__internal` or private helpers | Private paths prove nothing about public behavior |
| Do not copy source regression tests — write target-native proof | Source tests may target source-only helpers |
| Do not weaken `expectedValue` | Weakening hides the gap — this is the failure PortProof must detect |
| `expectedValue` must match `BehaviorContract.observable.expected` exactly | Contract and proof must be coherent |
| Assert the specific value, not just "no exception" | Exit-code-only proofs can pass silently on wrong values |

---

### Phase 5 — Deterministic verification (runner only, no Bob)

Bob does not participate in Phase 5.

The runner evaluates six gates in order:

```
Gate 1: BehaviorContract passes Zod schema validation
Gate 2: ExecutableProof publicBoundary validation passes
Gate 3: ProofIntegrityRecord written (contractHash + proofHash frozen)
Gate 4: ExistingTestsResult.passed === true   (npm test / test command)
Gate 5: SemanticProofResult.passed === true   (proof command exit 0)
Gate 6: SemanticProofResult.proofHash === ProofIntegrityRecord.proofHash
```

Verdicts:
- **PROVEN** — all six gates pass.
- **NOT_PROVEN** — gates 1–3 succeeded, gate 4 or 5 failed, execution completed.
- **UNVERIFIABLE** — gate 1 or 2 failed, proof file missing, command not found,
  signal exit, hash mismatch, malformed JSON from Bob, or Git operation failed.

**A semantic proof result of `passed: true` cannot produce PROVEN if existing
tests fail. Both gates 4 and 5 must pass.**

`ProofIntegrityRecord` is written before the first semantic proof execution
and is immutable. It records:

```typescript
{
  contractHash: string;  // SHA-256 of behavior-contract.json
  proofHash: string;     // SHA-256 of the proof file
  frozenAt: string;      // ISO timestamp
}
```

---

### Phase 6a — Report (PROVEN)

Runner emits `BackportProofReport` with `verdict: "PROVEN"`.

---

### Phase 6b — Repair (`bob-repair-agent`, NOT_PROVEN only)

**Input:** `SemanticProofResult` + `TargetAnalysis`.

**Goal:** propose the minimal application-code change that would make the
proof pass.

**Allowed modifications:** target application source files only.

**Forbidden modifications:**

| Artifact | Why |
|---|---|
| `BehaviorContract` | Contract defines what must be true; changing it hides the gap |
| `ExecutableProof` | Proof defines how it is measured; weakening it defeats the purpose |
| Proof assertions | Same as above |
| `expectedValue` | Weakening expected values is the exact failure PortProof must catch |
| Regression tests | Deleting or adjusting tests to obtain a pass is not a repair |

After the repair diff is produced, the runner applies it to an isolated
workspace and re-runs gates 4 and 5 using the **exact same frozen
`proofHash`** artifact. The hash must still match; any mismatch aborts with
UNVERIFIABLE.

Produce `RepairProposal`:

```typescript
{
  contractId: string;
  targetRef: string;
  allowedPaths: string[];      // application source files Bob may touch
  modifiedPaths: string[];     // files actually modified
  reasoning: string;           // why this repair closes the gap
  expectedEffect: {
    observable: Record<string, unknown>;
  };
  proofMutationRequired: false;  // must always be false
  testMutationRequired: false;   // must always be false
  uncertainties: string[];       // explicit, not guessed away
}
```

**Artifact:** `.portproof/runs/<runId>/repair-proposal.json`

---

## Artifact handoff contracts

```
GitInspector  →  SourceFixEvidence
Bob(SourceAgent)   ← SourceFixEvidence only        →  SourceAnalysis
Bob(TargetAgent)   ← SourceFixEvidence only        →  TargetAnalysis
Bob(BehaviorMapper)← SourceAnalysis + TargetAnalysis →  BehaviorContract + TargetMapping
Runner.validate    ← BehaviorContract              →  schema-valid | UNVERIFIABLE
Bob(ProofAdapter)  ← BehaviorContract + TargetAnalysis → ExecutableProof + proof file
Runner.validate    ← ExecutableProof               →  boundary-valid | UNVERIFIABLE
Runner.hash        ← BehaviorContract + proof file →  ProofIntegrityRecord (frozen)
Runner             ← target branch                 →  ExistingTestsResult
Runner             ← ExecutableProof (frozen)      →  SemanticProofResult
Runner             ← gate results                  →  verdict
Bob(RepairAgent)   ← SemanticProofResult + TargetAnalysis → RepairProposal
Runner             ← RepairProposal                →  apply to isolated workspace
Runner             ← ExecutableProof (same proofHash) → SemanticProofResult (rerun)
Reporter           ← all artifacts + hashes        →  BackportProofReport
```

---

## Trust boundary summary

| Actor | Owns | Does not own |
|---|---|---|
| Bob SourceAgent | SourceAnalysis | Any verdict, any target inspection |
| Bob TargetAgent | TargetAnalysis | Any verdict, SourceAnalysis as input |
| Bob BehaviorMapper | BehaviorContract, TargetMapping | Schema validation, verdict |
| Bob ProofAdapter | ExecutableProof descriptor, proof file | Public-boundary validation, verdict |
| Bob RepairAgent | RepairProposal (app code only) | Contract, proof, assertions, expected values, tests, verdict |
| Runner | Schema validation, hashing, test execution, proof execution, patch application, verdict | Any artifact content |

**Bob never assigns a verdict.** The runner's gate results are the only
inputs to PROVEN / NOT_PROVEN / UNVERIFIABLE.

---

## Uncertainty handling

When Bob cannot establish a fact with confidence:

- State the uncertainty explicitly in `contextNotes` (SourceAnalysis),
  `architecturalDifferences` (TargetAnalysis), `uncertainties`
  (RepairProposal), or `unverifiableReason` (BehaviorContract).
- Do **not** guess away uncertainty by choosing the most plausible value.
- Prefer producing UNVERIFIABLE with a clear reason over producing a
  plausible-but-wrong contract or proof.

---

## Common failure modes to avoid

| Mistake | Consequence |
|---|---|
| TargetAgent reads SourceAnalysis first | Anchors target investigation to source structure; misses architectural drift |
| Proof imports a helper instead of the public export | Proof passes while public routing is still broken — the exact failure PortProof must detect |
| Weakening `expectedValue` to match broken behavior | Hides the gap; turns a NOT_PROVEN into a false PROVEN |
| Copying source regression test to target | May pass on an unreachable function; does not validate the routing path |
| RepairAgent modifying the proof or contract | Conceals the gap instead of closing it |
| Bob declaring verdict from code review | Bypasses deterministic gates; violates the core invariant |

---

## Repository-independence note

This skill contains no fixture-specific values (no function names, file
paths, hash values, timeout constants, or environment variable names from any
particular repository). All examples in this skill use generic placeholders.
Apply the workflow to the actual repository by reading its code, then mapping
its public exports, routing paths, and test conventions into the artifact
schemas above.
