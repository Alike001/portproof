import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createApp } from "./app.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number.parseInt(process.env.PORT ?? "4174", 10);
const host = process.env.HOST ?? "0.0.0.0";
const { app } = createApp(repositoryRoot);

app.listen(port, host, () => {
  console.log(`PortProof web server listening on http://${host}:${String(port)}`);
});
