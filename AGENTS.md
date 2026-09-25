# PortProof Agent Context

## Mission
Build PortProof, a semantic backport verification tool. PortProof proves whether a bug fix preserves its intended observable behavior when moved from a source branch to an older release branch.

## Non-negotiable invariant
AI may reason, inspect, map intent, propose proofs, and propose repairs. Deterministic code owns execution and the final verification verdict.

Never declare a backport PROVEN because:
- the cherry-pick was clean,
- compilation succeeded,
- existing CI passed,
- an AI says the patch looks correct.

PROVEN requires a deterministic behavior proof to pass on the target branch.

## Initial scope
- JavaScript/TypeScript repositories
- local Git repositories
- source fix commit + target branch
- deterministic proof executed by Node/npm commands
- no automatic merge or release publication in MVP

## Architecture responsibilities

### Bob source-fix analysis
Inspect the source fix, changed files, tests, and available issue/PR context. Produce evidence for the behavioral intent.

### Bob target-branch analysis
Inspect the target branch independently. Identify the branch-native execution path and testing conventions. Do not assume source architecture applies to the target.

### Behavior Contract
Produce a structured contract describing the observable behavior that must hold on the target branch. Keep claims tied to source evidence.

### Proof adapter
Create or adapt the target-native executable proof needed to evaluate the Behavior Contract.

### Deterministic verifier
Runs commands and decides PASS/FAIL only from actual process results and validated artifacts.

### Repair step
If proof fails, propose the smallest target-native repair. Re-run all required checks after any repair.

## Safety rules
- Never push, merge, tag, publish, or release automatically.
- Never delete a failing regression test to obtain a pass.
- Never weaken the proof expectation to fit the target implementation.
- Never replace deterministic verification with an AI judgment.
- Preserve source and target commit provenance.
- Fail closed when proof execution cannot be established.

## Development style
- Prefer small modules with tests.
- Keep Git operations and verification code deterministic.
- Use structured JSON for machine-readable reports.
- Keep human-readable terminal output concise.
- Every major feature needs a test fixture.
- Do not add a web UI until the CLI verification path works end to end.

## First acceptance fixture
Use `portproof-fixture`.

Expected:
- `demo-clean-backport` -> NOT_PROVEN
- `demo-proven-backport` -> PROVEN
