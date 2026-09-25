# PortProof UX Product Spec

## UX goal
A maintainer or judge should understand the problem and verdict within 10 seconds, without knowing backport internals.

Primary message:

> A clean cherry-pick proves the code moved. PortProof proves the fix moved.

## UX principles
1. Lead with the dangerous contradiction: Git CLEAN + CI PASS + behavior FAIL.
2. Make evidence visible. Never hide the command, public behavior, source/target mapping, or verdict behind generic AI prose.
3. Separate mechanical status from semantic proof.
4. Use Bob as an investigator and repair partner, not as the final authority.
5. Keep the main flow to one page plus a proof detail drawer/page.
6. Default to a prepared demo fixture so judges see value immediately.
7. Avoid AI confidence scores. Use explicit states: PROVEN, NOT_PROVEN, UNVERIFIABLE, NEEDS_HUMAN.
8. Make the failure state more informative than the success state.

## Information architecture

### Public landing page
Purpose: explain the product and start a proof.

Sections:
1. Hero
2. Interactive demo / proof launcher
3. Three-step explanation
4. Why normal backport checks can miss the bug
5. Bob-native workflow
6. Proof artifact example
7. Open-source / technical trust section

### Proof workspace
Purpose: show one backport verification end to end.

Primary regions:
- Source fix
- Target release
- Mechanical checks
- Behavior Contract
- Executable proof
- Bob findings
- Final verdict

### Proof detail
Purpose: auditability.

Show:
- source commit and diff evidence
- target mapping
- proof file path
- exact command
- stdout/stderr
- exit code
- repair diff
- rerun history

## Landing page hero

Eyebrow:
Semantic backport verification

Headline:
A clean cherry-pick proves the code moved. PortProof proves the fix moved.

Subcopy:
PortProof uses IBM Bob to understand what a source bug fix was meant to change, maps that behavior onto an older release branch, and runs an executable proof before the backport is trusted.

Primary CTA:
Run the broken backport demo

Secondary CTA:
See how proof works

Hero visual:
A compact three-column status card:

GIT        CLEAN
CI         PASS
PORTPROOF  NOT PROVEN

Under it, one evidence line:
REQUEST_TIMEOUT_MS=0 -> expected 0, observed 5000

The hero should show the contradiction immediately. Do not lead with an abstract architecture diagram.

## Demo-first interaction

The landing page should offer a prepared fixture without requiring GitHub authentication or repository setup.

Demo cards:
- Clean but wrong backport
- Correct target-native adaptation

Clicking the first should animate through:
1. Cherry-pick clean
2. Existing tests pass
3. Behavior Contract appears
4. Public behavior proof fails
5. Verdict becomes NOT_PROVEN
6. Bob explains source/target implementation mismatch

A second action, "Apply target-native repair", runs the proven branch and changes only the semantic proof state from FAIL to PASS.

## Main proof workspace

### Header
- PortProof wordmark
- repository / fixture name
- source -> target branch selector
- Run proof button
- compact Bob activity indicator

### Verdict strip
This is the dominant visual element.

Mechanical
- Cherry-pick: CLEAN
- Existing CI/tests: PASS

Semantic
- Behavior proof: FAIL
- Final verdict: NOT_PROVEN

Never merge these into one score.

### Behavior Contract card
Show the contract as human-readable fields first, raw JSON second.

Intent:
REQUEST_TIMEOUT_MS=0 disables request timeout

Setup:
REQUEST_TIMEOUT_MS=0

Operation:
Resolve timeout through the public request path

Expected:
timeoutMs = 0

Observed:
timeoutMs = 5000

### Source vs target mapping
Two-column comparison:

Source branch
- parseModernTimeout
- source regression test
- changed commit

Target branch
- public request path -> parseLegacyTimeout
- copied source test -> parseModernTimeout
- production path bypasses copied fix

The UI should visually connect the source intent to the actual target execution path.

### Bob investigation panel
Show Bob's work as evidence-backed steps, not a chat transcript.

Example:
- Source investigator: identified public behavior and source evidence
- Target investigator: found release branch still routes through parseLegacyTimeout
- Mapper: generated target-native proof
- Repair agent: proposed minimal legacy-path fix

Every step should link to files or proof artifacts.

### Proof runner
Show:
- command
- duration
- exit code
- assertion result
- captured output

This is where trust comes from.

## States

### PROVEN
Message:
The target branch demonstrates the source fix's intended behavior through its real public path.

### NOT_PROVEN
Message:
The backport is mechanically clean, but the intended behavior is still broken on the target branch.

### UNVERIFIABLE
Message:
PortProof could not build a reliable executable proof from the available evidence.

### NEEDS_HUMAN
Message:
The behavior depends on ambiguity or environment conditions that PortProof cannot safely resolve automatically.

## Visual direction

Tone: developer infrastructure, not generic AI SaaS.

Use:
- dark neutral background
- high contrast evidence cards
- monospace for commits, branches, commands and observed values
- restrained status accents for PASS / FAIL / PROVEN
- thin connectors between source and target evidence
- minimal animation tied to state transitions

Avoid:
- glowing AI gradients everywhere
- chat bubbles as the main product UI
- generic dashboards full of charts
- percentage confidence scores
- decorative robot mascots dominating the page

## Responsive behavior

Desktop:
- source and target comparison side by side
- verdict strip visible without scrolling

Mobile:
- source and target stack vertically
- verdict strip remains first
- raw logs collapse into disclosure panels

## Accessibility
- Status must use icon/text labels, not color alone.
- Keyboard accessible proof controls.
- Respect reduced motion.
- Logs and code blocks use selectable text.
- Maintain WCAG AA contrast for primary states.

## UX acceptance criteria
1. A new user can state what PortProof does after seeing only the hero.
2. The fixture demo reaches NOT_PROVEN in three clicks or fewer.
3. The difference between Git/CI status and semantic verdict is visually obvious.
4. Every final verdict exposes deterministic evidence.
5. Bob's role is visible without requiring the user to read a chat transcript.
6. The repaired fixture can be rerun from the same screen and end in PROVEN.
