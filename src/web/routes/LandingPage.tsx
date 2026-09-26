import { Link } from "react-router-dom";
import { SectionHeading } from "../components/SectionHeading.js";
import { StatusPill } from "../components/StatusPill.js";

function ContradictionPreview() {
  return (
    <aside className="preview-card" aria-label="Demo preview">
      <div className="preview-card__header">
        <span className="eyebrow">Demo preview · example data</span>
        <span className="preview-card__pulse" aria-hidden="true" />
      </div>
      <div className="preview-group">
        <p className="preview-group__title">Mechanical</p>
        <div className="preview-row"><span>Cherry-pick</span><StatusPill status="CLEAN" /></div>
        <div className="preview-row"><span>Existing tests</span><StatusPill status="PASS" /></div>
      </div>
      <div className="preview-group preview-group--semantic">
        <p className="preview-group__title">Semantic</p>
        <div className="preview-row"><span>Behavior proof</span><StatusPill status="FAIL" /></div>
        <div className="preview-observation">
          <div><span>Expected</span><strong>0</strong></div>
          <span className="preview-observation__arrow" aria-hidden="true">→</span>
          <div><span>Observed</span><strong>5000</strong></div>
        </div>
      </div>
      <div className="preview-verdict">
        <span>PortProof</span>
        <StatusPill status="NOT_PROVEN" label="NOT PROVEN" />
      </div>
    </aside>
  );
}

export function LandingPage() {
  return (
    <main>
      <section className="hero page-shell">
        <div className="hero__copy">
          <p className="eyebrow eyebrow--accent"><span aria-hidden="true">●</span> Semantic backport verification</p>
          <h1>A clean cherry-pick proves the code moved.<br /><em>PortProof proves the fix moved.</em></h1>
          <p className="hero__lede">
            PortProof uses IBM Bob to reconstruct what a source fix was meant to change, then verifies that exact public behavior on the release branch with deterministic executable evidence.
          </p>
          <div className="hero__actions">
            <Link className="button button--primary" to="/verify?autorun=1">
              Run broken backport demo <span aria-hidden="true">→</span>
            </Link>
            <a className="button button--secondary" href="#how-it-works">See how verification works</a>
          </div>
          <div className="hero__trust">
            <span><b aria-hidden="true">✓</b> Local fixture</span>
            <span><b aria-hidden="true">✓</b> Frozen proof</span>
            <span><b aria-hidden="true">✓</b> No AI verdicts</span>
          </div>
        </div>
        <ContradictionPreview />
      </section>

      <section className="section page-shell" id="how-it-works">
        <SectionHeading eyebrow="Why PortProof" title="Green checks can preserve the wrong behavior." />
        <div className="feature-grid feature-grid--three">
          <article className="feature-card feature-card--numbered">
            <span className="feature-card__number">01</span>
            <h3>Mechanical success</h3>
            <p>The commit applies cleanly. The copied regression test reaches a helper that exists on both branches.</p>
          </article>
          <article className="feature-card feature-card--numbered">
            <span className="feature-card__number">02</span>
            <h3>Architectural drift</h3>
            <p>The release branch’s public request path still routes through legacy logic and bypasses the fix.</p>
          </article>
          <article className="feature-card feature-card--numbered feature-card--accent">
            <span className="feature-card__number">03</span>
            <h3>Executable evidence</h3>
            <p>PortProof runs the declared public behavior and assigns a verdict from measured process results.</p>
          </article>
        </div>
      </section>

      <section className="section section--contained page-shell">
        <SectionHeading eyebrow="Trust boundary" title="Bob investigates. PortProof decides." />
        <div className="trust-boundary">
          <div className="trust-column">
            <p className="panel-label">Bob-generated evidence</p>
            <h3>Reconstruct intent across branches</h3>
            <ul className="clean-list">
              <li>Source fix analysis</li>
              <li>Independent target mapping</li>
              <li>BehaviorContract and public proof</li>
              <li>Minimal repair proposal</li>
            </ul>
          </div>
          <div className="trust-divider" aria-hidden="true"><span>validated artifacts</span><b>→</b></div>
          <div className="trust-column trust-column--deterministic">
            <p className="panel-label">Deterministic verification</p>
            <h3>Validate, freeze, execute</h3>
            <ul className="clean-list">
              <li>Strict schemas and public boundary</li>
              <li>SHA-256 contract and proof integrity</li>
              <li>Existing tests and behavior assertion</li>
              <li>Final machine verdict</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section page-shell">
        <SectionHeading eyebrow="Prepared demo preview · frozen-proof repair" title="Change the target code. Never move the goalposts." />
        <div className="frozen-story">
          <div className="story-state story-state--fail">
            <span className="story-state__label">Before repair</span>
            <strong>Observed 5000</strong>
            <StatusPill status="NOT_PROVEN" label="NOT PROVEN" />
          </div>
          <div className="proof-spine">
            <span>same proof</span>
            <code>9780973a…</code>
          </div>
          <div className="story-state story-state--pass">
            <span className="story-state__label">After repair</span>
            <strong>Observed 0</strong>
            <StatusPill status="PROVEN" />
          </div>
        </div>
      </section>

      <section className="section section--report page-shell">
        <div>
          <p className="eyebrow">Backport Proof Report</p>
          <h2>The artifact your release decision can cite.</h2>
          <p>Every run records provenance, the exact BehaviorContract, commands, outputs, hashes, repair scope, and the deterministic verdict.</p>
        </div>
        <Link className="button button--primary" to="/verify">Open demo workspace <span aria-hidden="true">→</span></Link>
      </section>

      <section className="section local-workflow page-shell">
        <SectionHeading eyebrow="Use PortProof on your repository" title="The hosted demo is prepared. The local CLI is repository-oriented." />
        <div className="local-workflow__grid">
          <ol>
            <li><code>portproof init</code><span>Create the strict JS/TS project configuration.</span></li>
            <li><strong>Open in IBM Bob</strong><span>Use portproof-verifier mode with the semantic-backport Skill.</span></li>
            <li><strong>Generate semantic artifacts</strong><span>Produce the contract, target mapping, and executable proof.</span></li>
            <li><code>portproof verify-repo …</code><span>Verify source and target refs in an isolated checkout.</span></li>
          </ol>
          <pre><code>{`portproof verify-repo \\\n  --repo . \\\n  --source fix/timeout-zero \\\n  --target release/1.x \\\n  --contract artifacts/behavior-contract.json \\\n  --proof-metadata artifacts/executable-proof.json`}</code></pre>
        </div>
      </section>
    </main>
  );
}
