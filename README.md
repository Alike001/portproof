# PortProof

> A clean cherry-pick proves the code moved. PortProof proves the fix moved.

PortProof is a repository-agnostic semantic backport verification framework. The hackathon release ships with a JavaScript/TypeScript adapter and a prepared scenario that demonstrates the clean-but-wrong backport failure mode.

A cherry-pick, build, or existing test suite can succeed while an older release branch routes public behavior through different code. PortProof validates a structured behavior contract, freezes an executable public-boundary proof, runs it in an isolated target checkout, and derives `PROVEN`, `NOT_PROVEN`, or `UNVERIFIABLE` only from deterministic evidence.

## Prepared web demo

Requirements: Node.js 20+, npm, and Git.

```sh
npm install
npm run dev
```

Open `http://localhost:5173`. Vite serves the React application and proxies the constrained demo API to the Express server on port `4174`.

For a production-style local run:

```sh
npm run build
npm start
```

The hosted web surface intentionally accepts only the bundled `semantic-backport` scenario. It does not accept repository paths or arbitrary commands. The demo shows real core execution: a clean target with passing tests is `NOT_PROVEN`, then a policy-validated repair becomes `PROVEN` under the exact same frozen proof.

## Use PortProof on a repository

Initialize a local JavaScript/TypeScript Git repository:

```sh
npm run portproof -- init --repo /path/to/repository
```

This creates `.portproof/project.json` with a shell-free test command:

```json
{
  "version": "1",
  "language": "javascript",
  "test": {
    "command": "npm",
    "args": ["test"]
  }
}
```

The default stays minimal and runs no setup. Repositories that need dependencies or compiled runtime output must explicitly add ordered, user-owned preparation commands:

```json
{
  "version": "1",
  "language": "javascript",
  "prepare": [
    { "command": "npm", "args": ["ci"] },
    { "command": "npm", "args": ["run", "build"] }
  ],
  "test": {
    "command": "npm",
    "args": ["test"]
  }
}
```

PortProof runs these commands in order with shell execution disabled and stops on the first failure. Preparation runs only in the isolated target checkout. Generated untracked or ignored files are allowed, but any change to tracked files makes the run `UNVERIFIABLE`.

Open the repository in IBM Bob using the `portproof-verifier` mode and `semantic-backport` Skill. Bob investigates the source and target independently and generates SourceAnalysis, TargetAnalysis, BehaviorContract, TargetMapping, and ExecutableProof artifacts. Then run:

```sh
npm run portproof -- verify-repo \
  --repo /path/to/repository \
  --source fix/timeout-zero \
  --target release/1.x \
  --contract /path/to/repository/artifacts/behavior-contract.json \
  --proof-metadata /path/to/repository/artifacts/executable-proof.json
```

PortProof resolves both refs, clones the target commit into a temporary checkout, runs configured preparation, validates the proof's declared public import against the prepared checkout, runs the test executable with its argument array, copies the proof's exact bytes without rewriting, and records source/copy/pre/post SHA-256 hashes. The supplied repository is not checked out or modified by verification.

## Trust boundary

IBM Bob proposes structured evidence and, when requested, a repair. Deterministic PortProof code owns:

- strict Zod schema validation;
- Git ref and commit provenance;
- JavaScript/TypeScript static public-boundary validation;
- isolated preparation, test, and proof execution without a shell;
- contract and proof integrity hashes;
- the final machine verdict.

Bob never assigns the final verdict. Malformed evidence, missing refs, unsupported configuration, unparseable observations, or failed execution infrastructure fail closed as `UNVERIFIABLE`.

## Current scope

The current adapter supports local Git repositories containing JavaScript or TypeScript projects whose preparation and target tests can be invoked as executables plus argument arrays. Proofs execute with Node and must statically import and invoke the declared repository-relative public boundary. Preparation is trusted only from the local `.portproof/project.json`; Bob artifacts cannot define commands.

PortProof does not currently provide adapters for Python, Go, Rust, Java, remote repository execution, automatic setup inference, or universal API correctness. The `LanguageAdapter` boundary isolates public-proof validation and observation parsing so future languages can be added without weakening the deterministic core.

The original prepared commands remain available:

```sh
npm run portproof -- verify --fixture semantic-backport --branch demo-clean-backport
npm run portproof -- repair --fixture semantic-backport --branch demo-clean-backport \
  --contract artifacts/bob/behavior-contract.candidate.json \
  --proof-metadata artifacts/bob/executable-proof.json \
  --repair-proposal artifacts/bob/repair-proposal.json \
  --patch artifacts/bob/repairs/request-timeout-zero.patch
```
