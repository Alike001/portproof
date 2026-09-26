# PortProof

PortProof verifies that a backported fix preserves its intended observable behavior on the target release branch.

## Local web demo

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

The prepared demo is intentionally limited to the bundled `semantic-backport` scenario. The browser cannot submit repository paths or shell commands, and all final verdicts come from the existing deterministic PortProof core.
