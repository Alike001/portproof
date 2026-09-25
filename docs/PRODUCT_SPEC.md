# PortProof Product Spec

## One-line product
PortProof proves that a bug fix still has the intended behavior after it is moved to an older release branch.

## Core problem
A clean cherry-pick and green CI do not prove semantic equivalence across diverged release branches. A patch can apply cleanly, its copied tests can pass, and the actual public behavior can still remain broken because the target branch uses a different implementation path, test harness, configuration layer, or abstraction.

## Core product promise
Given a source fix and a target release branch, PortProof:
1. derives the observable intent of the source fix,
2. maps that intent onto the target branch,
3. creates or adapts an executable target-native proof,
4. runs deterministic verification,
5. reports PROVEN or NOT PROVEN,
6. when NOT PROVEN, uses IBM Bob to propose a minimal target-native adaptation,
7. re-runs the deterministic proof before declaring success.

## What PortProof is not
- Not a generic cherry-pick bot.
- Not a merge-conflict resolver.
- Not a generic AI code reviewer.
- Not a CI replacement.
- Not a system where an LLM decides PASS/FAIL.

## Product boundary
Existing tools may perform the mechanical backport. PortProof starts from a source fix plus a target branch and verifies semantic preservation.

## Initial supported wedge
The hackathon MVP focuses on bug-fix backports in JavaScript/TypeScript repositories with runnable local tests and a deterministic public-behavior proof.

This narrow wedge is intentional. The architecture should allow future adapters for other languages and test harnesses.

## Primary user
Maintainers supporting multiple release branches who need confidence that a backported bug fix actually fixes the same behavior on an older branch.

## Primary workflow
1. Maintainer selects a source fix commit/PR and target release branch.
2. PortProof records source and target provenance.
3. Bob source subagent inspects diff, issue/PR context, affected tests, and behavior.
4. Bob target subagent independently inspects target architecture and branch-native test path.
5. Bob creates a structured Behavior Contract.
6. Bob adapts or writes a target-native proof from that contract.
7. PortProof deterministic runner executes existing tests and the proof.
8. If the proof fails, Bob proposes the minimal target-native repair.
9. PortProof reruns the proof and existing tests.
10. PortProof emits a Backport Proof Report.

## Behavior Contract
PortProof should use a structured intermediate artifact rather than free-form prose.

Suggested shape:

```json
{
  "id": "request-timeout-zero-disables-timeout",
  "source": {
    "commit": "<sha>",
    "branch": "main"
  },
  "target": {
    "branch": "release/1.x"
  },
  "intent": "REQUEST_TIMEOUT_MS=0 disables request timeout",
  "observable": {
    "setup": {"REQUEST_TIMEOUT_MS": "0"},
    "operation": "resolve request timeout through the public request path",
    "expected": {"timeoutMs": 0}
  },
  "evidence": {
    "source_files": [],
    "source_tests": [],
    "target_files": []
  }
}
```

The model may propose this contract. Deterministic code owns schema validation and execution status.

## Verdict model
Use explicit states:
- PROVEN
- NOT_PROVEN
- UNVERIFIABLE
- NEEDS_HUMAN

Do not use vague AI confidence scores as the final authority.

## Required report fields
- Source commit and branch
- Target branch and commit
- Mechanical application status
- Existing target test status
- Source-fix intent
- Source implementation path
- Target implementation path
- Proof artifact path
- Proof command
- Proof exit status
- Repair summary if any
- Final verdict

## Demo fixture acceptance case
The supplied portproof-fixture is the first required acceptance test.

### demo-clean-backport
- `npm test` -> PASS
- `npm run proof` -> FAIL
- expected PortProof verdict -> NOT_PROVEN

### demo-proven-backport
- `npm test` -> PASS
- `npm run proof` -> PASS
- expected PortProof verdict -> PROVEN

## Demo sentence
"Git says the backport is clean. CI says it passes. PortProof proves whether the original bug is actually fixed on the old branch."

## Success metrics for hackathon demo
At minimum demonstrate:
- one clean cherry-pick that normal tests accept but PortProof rejects,
- one target-native adaptation that PortProof accepts,
- deterministic PASS/FAIL evidence,
- Bob used across multiple reasoning steps rather than only code generation,
- visible before/after reduction in manual investigation steps.
