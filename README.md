# PortProof

> A clean cherry-pick proves the code moved.<br>
> **PortProof proves the fix moved.**

Git can apply a backport cleanly and CI can pass while the intended behavior is still missing. PortProof turns that behavioral intent into frozen executable evidence and tests it on the target release through its real public path.

```text
Git / mechanical application   CLEAN
Existing target tests          PASS
Semantic behavior proof        FAIL
PortProof                      NOT_PROVEN
```

IBM Bob reconstructs intent, independently maps the older target, creates a `BehaviorContract`, generates executable evidence, and can propose a bounded repair. Deterministic PortProof code validates those artifacts, freezes the proof bytes, runs preparation/tests/proof, enforces repair policy, and alone assigns `PROVEN`, `NOT_PROVEN`, or `UNVERIFIABLE`.

**Bob proposes. PortProof proves.**

## Prepared demo vs product

| | Prepared hosted demo | Repository-oriented product |
|---|---|---|
| Purpose | Immediate clean-but-wrong walkthrough | Verify a real local repository |
| Input | Fixed `semantic-backport` scenario | Repository path, source ref, target ref, Bob evidence |
| Execution | Constrained Express API | Local `portproof verify-repo` CLI |
| Safety boundary | Never accepts arbitrary repositories or commands | User-owned config, isolated temporary Git checkout |

Both paths call the same deterministic verification core. The demo is intentionally constrained; the CLI is the actual repository-oriented product.

## Real-world validation

PortProof was independently exercised against the public TypeScript repository [`korthout/backport-action`](https://github.com/korthout/backport-action), separate from the prepared fixture. This reproduced a documented historical fix; it is not a claim of affiliation or discovery of a previously unknown bug.

Behavior under proof: `getMentionedIssueRefs(' #042 ')` must return `[]`.

| Historical target | Preparation | Existing tests | Observed | Verdict |
|---|---:|---:|---|---|
| `v4.0.1` | PASS | PASS | `["#042"]` | `NOT_PROVEN` |
| `v4.1.0` | PASS | PASS | `[]` | `PROVEN` |

Both runs used proof SHA-256 `ab09a72fd7f02c24c00f5714faa1f572d589ec31556d0604e9f3cfd57bf458d5`; every source/copy/pre/post hash matched. See the [full validation record](docs/REAL_WORLD_VALIDATION.md) and the [captured evidence](docs/evidence/real-world/).

## Quick start

Requirements: Node.js 24+, npm, and Git. Commands below use the `portproof` executable name; inside this source checkout, run it as `npm run portproof -- <command>`.

### 1. Initialize the repository

```sh
portproof init --repo /path/to/repository
```

This creates a minimal `.portproof/project.json`. If the target needs dependencies or compilation, add explicit ordered preparation commands:

```json
{
  "version": "1",
  "language": "javascript",
  "prepare": [
    { "command": "npm", "args": ["ci"] },
    { "command": "npm", "args": ["run", "build"] }
  ],
  "test": { "command": "npm", "args": ["test"] }
}
```

Commands are executable-plus-argument arrays and run with shell execution disabled. Preparation may generate ignored or untracked output, but modifying tracked files fails closed.

### 2. Generate semantic evidence with IBM Bob

Open the repository in IBM Bob using:

- custom mode: `portproof-verifier`
- Skill: `semantic-backport`

The workflow produces SourceAnalysis, independent TargetAnalysis, a `BehaviorContract`, TargetMapping, and ExecutableProof metadata plus the exact proof file.

### 3. Verify the target

```sh
portproof verify-repo \
  --repo /path/to/repository \
  --source <source-fix-ref> \
  --target <target-release-ref> \
  --contract <behavior-contract.json> \
  --proof-metadata <executable-proof.json>
```

PortProof resolves both refs and SHAs, clones the target into a temporary checkout, prepares it, validates the declared public boundary, runs existing tests, executes the unchanged proof, and writes a structured Backport Proof Report. The supplied repository is never checked out or modified.

## Run the prepared web demo

```sh
npm install
npm run dev
```

Open `http://localhost:5173`. The broken target shows passing tests plus a failing behavior proof; applying the Bob-proposed repair invokes the real deterministic repair gate and reverifies the exact same proof.

Production-style local run:

```sh
npm run build
npm start
```

### Docker deployment

The production image serves the Express API and built Vite app as one Node 24 service. It includes Git, npm, the prepared fixture bundle, and the Bob-generated evidence required by the constrained hosted demo.

```sh
docker build -t portproof .
docker run --rm -p 8080:8080 -e PORT=8080 portproof
curl http://127.0.0.1:8080/api/health
```

The service binds to `0.0.0.0`; reports under `.portproof/runs/` are ephemeral unless the deployment provides persistent writable storage. The hosted API remains limited to the prepared scenario—use the local CLI for repository-oriented verification.

## Architecture and trust boundary

```text
IBM Bob
  SourceAgent · TargetAgent · BehaviorMapper · ProofAdapter · RepairAgent
                              │
                    structured evidence
                              ▼
PortProof deterministic core
  schema validation → public-boundary validation → SHA-256 freezing
  → preparation/tests/proof execution → patch policy → verdict
```

Bob may investigate, map, generate evidence, and propose repairs. Bob cannot assign a verdict. PortProof derives its verdict from validated artifacts, Git provenance, exact hashes, and measured process results. Malformed evidence or unavailable infrastructure becomes `UNVERIFIABLE`, never a guessed result.

## Meaningful IBM Bob 2.0 use

PortProof uses Bob as part of the product workflow—not merely as the coding assistant that built it:

- focused agent tasks reconstruct the source fix and inspect the target;
- SourceAgent and TargetAgent reason independently to avoid architectural anchoring;
- the reusable `semantic-backport` Skill defines the evidence workflow;
- the `portproof-verifier` custom mode bounds Bob to investigation and artifact production;
- structured JSON artifacts hand reasoning across the deterministic trust boundary;
- RepairAgent proposes a path-bounded repair that PortProof independently validates and reverifies.

## Verdicts

- `PROVEN`: preparation and existing tests passed, evidence and hashes are valid, and the frozen semantic proof passed.
- `NOT_PROVEN`: valid evidence executed meaningfully, existing tests passed, but the contracted behavior failed.
- `UNVERIFIABLE`: malformed evidence, unsupported configuration, integrity failure, missing infrastructure, or another condition prevented a meaningful proof.

## Current support and limitations

Current support:

- local Git repositories;
- JavaScript/TypeScript through the shipped JavaScript adapter;
- user-specified source and target refs;
- explicit deterministic preparation and test commands;
- immutable Node-executed public-boundary proofs.

Limitations:

- no adapters for other languages yet;
- dependency preparation may require network access;
- temporary Git checkouts provide repository isolation, not OS-container isolation;
- the hosted demo intentionally does not accept arbitrary repositories;
- PortProof proves the validated contract and declared path, not universal program correctness.

## Development checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
```
