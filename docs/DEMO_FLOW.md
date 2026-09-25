# PortProof Demo Flow

## Demo objective
In under 90 seconds, prove the product catches a failure that Git and ordinary tests miss, then show Bob helping produce the correct target-native repair.

## Opening, 0:00-0:12
Show the PortProof landing hero.

Say:
"This backport is clean and every existing test passes. The bug is still there. PortProof proves whether the fix actually survived the backport."

Click: Run broken backport demo.

## Mechanical checks, 0:12-0:25
Show:
- source: main fix commit
- target: demo-clean-backport / release/1.x
- cherry-pick: CLEAN
- npm test: PASS, 3/3

Do not dwell on logs.

## Behavior Contract, 0:25-0:38
Reveal:
Intent: REQUEST_TIMEOUT_MS=0 disables timeout
Expected: public timeout = 0

Show source evidence briefly.

## Contradiction, 0:38-0:50
Run public proof.

Show:
Observed: 5000
Expected: 0

Verdict changes to:
NOT_PROVEN

Say:
"The copied regression test passed because it exercised the newer parser. The old release's public request path still uses the legacy parser."

## Bob investigation, 0:50-1:05
Show a compact evidence timeline:
- source investigator identifies behavioral promise
- target investigator finds legacy execution path
- mapper creates target-native proof
- repair agent proposes minimal legacy-path fix

Avoid showing a long chat transcript.

## Repair and re-proof, 1:05-1:20
Click: Apply target-native repair.

Run:
- existing tests
- exact same behavior proof

Show:
Existing tests PASS
Public proof PASS
PORTPROOF PROVEN

## Close, 1:20-1:30
Show final Proof Report.

Say:
"Git proved the commit moved. PortProof proved the fix moved. IBM Bob handled the cross-branch reasoning, and deterministic execution supplied the verdict."

## Longer judge walkthrough
If more time is available, expand:
1. source/target mapping
2. Behavior Contract JSON
3. exact proof command and exit code
4. Bob Skill and custom mode
5. lifecycle gate
6. bob_sessions evidence

## Demo safety
- Use the local deterministic fixture as the primary demo.
- Keep the fixture preloaded.
- Do not depend on live GitHub APIs for the main path.
- Do not depend on paid APIs for the main proof.
- Keep a recorded fallback video.
- Keep the PROVEN and NOT_PROVEN fixture branches immutable after final validation.
