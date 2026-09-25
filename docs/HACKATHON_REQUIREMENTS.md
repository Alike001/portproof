# IBM Bob 2.0 Hackathon Requirements Ledger

Treat this file as a build constraint, not marketing notes.

## Challenge fit
The prototype must improve a specific developer workflow where time, effort, errors, or rework are too high.

PortProof workflow: verifying bug-fix backports across diverged release branches.

## IBM Bob requirement
IBM Bob IDE must be a core component of the solution.

Using Bob only to generate application code is not enough for our design. Bob must participate in the product workflow through source analysis, target analysis, behavior-contract generation, target-native proof adaptation, and repair reasoning.

## Bob 2.0 capabilities we intend to demonstrate
- Agent mode
- focused subagents
- parallel investigation where useful
- repository/document understanding
- reusable Skill for semantic backport verification
- custom mode for bounded backport verification
- optional lifecycle hook for deterministic gating

## Evidence requirement
Every participant must preserve relevant Bob IDE task session summary screenshots in the final repository under:

`bob_sessions/`

Capture these during development.

## Bobcoin constraint
The hackathon-provisioned account has 40 Bobcoins. Use focused tasks and reusable project context. Avoid broad exploratory prompts inside Bob.

## Data restrictions
Prefer synthetic fixtures and open-source repositories.
Do not use:
- client data,
- confidential company data,
- personal information,
- social-media datasets.

Keep a source list for public web data used in the project.

## Judging dimensions
Design and presentation should clearly support:
- Application of Technology
- Presentation
- Business Value
- Originality

## Submission hygiene
The final project must include the code/files where Bob assisted, plus the required Bob task-session evidence.

Create a permanent tag for the exact submitted version, suggested:

`v1.0-hackathon`

Do not rewrite that tag after judging.
