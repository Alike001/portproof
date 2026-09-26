import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createApp } from "./app.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requestedPort = Number.parseInt(process.env.PORT ?? "", 10);
const port = Number.isSafeInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65_535
  ? requestedPort
  : 4174;
const host = "0.0.0.0";
const { app } = createApp(repositoryRoot);

app.listen(port, host, () => {
  console.log(`PortProof web server listening on http://${host}:${String(port)}`);
});
