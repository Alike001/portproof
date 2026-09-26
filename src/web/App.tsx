import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SiteHeader } from "./components/SiteHeader.js";
import { LandingPage } from "./routes/LandingPage.js";
import { ReportPage } from "./routes/ReportPage.js";
import { VerifyPage } from "./routes/VerifyPage.js";

export function App() {
  return (
    <BrowserRouter>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <SiteHeader />
      <div id="main-content">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/report/:runId" element={<ReportPage />} />
          <Route path="*" element={<LandingPage />} />
        </Routes>
      </div>
      <footer className="site-footer page-shell">
        <span>PortProof</span>
        <p>Bob proposes structured evidence. Deterministic code decides.</p>
      </footer>
    </BrowserRouter>
  );
}
