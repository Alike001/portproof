import { Link, NavLink } from "react-router-dom";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="page-shell site-header__inner">
        <Link className="wordmark" to="/" aria-label="PortProof home">
          <span className="wordmark__mark" aria-hidden="true">P</span>
          <span>PortProof</span>
        </Link>
        <nav className="site-nav" aria-label="Primary navigation">
          <NavLink to="/verify">Demo</NavLink>
          <a href="/#how-it-works">How it works</a>
          <span className="trust-chip"><span aria-hidden="true">◆</span> Deterministic verdicts</span>
        </nav>
      </div>
    </header>
  );
}
