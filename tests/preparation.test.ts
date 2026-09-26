import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { loadProjectConfig } from "../src/core/project-config.js";
import { verifyRepository } from "../src/core/verify-repository.js";
import type { CommandSpec, PortProofProjectConfig } from "../src/core/types.js";

const exec = promisify(execFile);

interface PreparedRepository {
  dir: string;
  contractPath: string;
  metadataPath: string;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await exec("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "PortProof Preparation Tests",
      GIT_AUTHOR_EMAIL: "preparation@portproof.local",
      GIT_COMMITTER_NAME: "PortProof Preparation Tests",
      GIT_COMMITTER_EMAIL: "preparation@portproof.local",
    },
  });
  return result.stdout.trim();
}

async function createPreparedRepository(): Promise<PreparedRepository> {
  const dir = await mkdtemp(join(tmpdir(), "portproof-preparation-test-"));
  await git(dir, "init", "--initial-branch=main");
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "package.json"), '{"type":"module"}\n');
  await writeFile(
    join(dir, "src", "utils.ts"),
    "export function publicValue(): number { return 1; }\n"
  );
  await writeFile(
    join(dir, "build.mjs"),
    "import { mkdir, writeFile } from 'node:fs/promises';\n" +
      "await mkdir('lib', { recursive: true });\n" +
      "await writeFile('lib/utils.js', 'export function publicValue() { return 1; }\\n');\n" +
      "console.log('build:complete');\n"
  );
  await writeFile(
    join(dir, "ordered.mjs"),
    "import { access, mkdir, writeFile } from 'node:fs/promises';\n" +
      "const step = process.argv[2];\n" +
      "if (step === 'first') await writeFile('.prepare-first', 'ready');\n" +
      "if (step === 'second') { await access('.prepare-first'); await mkdir('lib', { recursive: true }); await writeFile('lib/utils.js', 'export function publicValue() { return 1; }\\n'); }\n" +
      "console.log(`step:${step}`);\n"
  );
  await writeFile(join(dir, "fail.mjs"), "console.error('prepare:failed'); process.exit(7);\n");
  await writeFile(
    join(dir, "second.mjs"),
    "import { writeFile } from 'node:fs/promises'; await writeFile('.second-ran', 'yes'); console.log('second:ran');\n"
  );
  await writeFile(
    join(dir, "modify-tracked.mjs"),
    "import { appendFile, mkdir, writeFile } from 'node:fs/promises'; await appendFile('src/utils.ts', '// changed\\n'); await mkdir('lib', { recursive: true }); await writeFile('lib/utils.js', 'export function publicValue() { return 1; }\\n');\n"
  );
  await writeFile(
    join(dir, "test.mjs"),
    "import assert from 'node:assert/strict'; import { publicValue } from './lib/utils.js'; assert.equal(publicValue(), 1);\n"
  );
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "add TypeScript-like target");
  await git(dir, "branch", "release/generated");

  await mkdir(join(dir, ".portproof", "proofs"), { recursive: true });
  const contractPath = join(dir, ".portproof", "behavior-contract.json");
  await writeFile(contractPath, JSON.stringify({
    version: "1",
    id: "generated-runtime-public-value",
    intent: "The compiled public runtime module returns one.",
    observable: { setup: {}, operation: "publicValue", expected: { value: 1 } },
  }, null, 2));
  const metadataPath = join(dir, ".portproof", "executable-proof.json");
  await writeFile(metadataPath, JSON.stringify({
    version: "1",
    contractId: "generated-runtime-public-value",
    language: "javascript",
    file: ".portproof/proofs/generated-runtime.proof.mjs",
    publicBoundary: { module: "lib/utils.js", export: "publicValue" },
    expected: { value: 1 },
  }, null, 2));
  await writeFile(
    join(dir, ".portproof", "proofs", "generated-runtime.proof.mjs"),
    "import assert from 'node:assert/strict';\n" +
      "import { publicValue } from './lib/utils.js';\n" +
      "const observed = { value: publicValue() };\n" +
      "console.log(`PORTPROOF_OBSERVED ${JSON.stringify(observed)}`);\n" +
      "assert.deepEqual(observed, { value: 1 });\n"
  );
  return { dir, contractPath, metadataPath };
}

async function configure(repository: PreparedRepository, prepare?: CommandSpec[]): Promise<void> {
  const config: PortProofProjectConfig = {
    version: "1",
    language: "javascript",
    ...(prepare !== undefined && { prepare }),
    test: { command: "node", args: ["test.mjs"] },
  };
  await writeFile(
    join(repository.dir, ".portproof", "project.json"),
    `${JSON.stringify(config, null, 2)}\n`
  );
}

async function verify(repository: PreparedRepository) {
  return verifyRepository({
    repositoryPath: repository.dir,
    sourceRef: "main",
    targetRef: "release/generated",
    contractPath: repository.contractPath,
    proofMetadataPath: repository.metadataPath,
  });
}

describe("deterministic repository preparation", () => {
  let repository: PreparedRepository;
  let originalStatus: string;

  beforeAll(async () => {
    repository = await createPreparedRepository();
    originalStatus = await git(repository.dir, "status", "--porcelain=v1");
  });

  afterAll(async () => {
    await rm(repository.dir, { recursive: true, force: true });
  });

  it("runs one preparation command and validates a generated public module afterward", async () => {
    await configure(repository, [{ command: "node", args: ["build.mjs"] }]);
    const report = await verify(repository);
    expect(report.verdict).toBe("PROVEN");
    expect(report.preparation).toMatchObject({ passed: true, trackedFilesUnchanged: true });
    expect(report.preparation?.commands).toHaveLength(1);
    expect(report.preparation?.commands[0]?.stdout).toContain("build:complete");
    expect(report.evidence?.executableProof.publicBoundary.module).toBe("lib/utils.js");
  });

  it("runs multiple preparation commands in declared order", async () => {
    await configure(repository, [
      { command: "node", args: ["ordered.mjs", "first"] },
      { command: "node", args: ["ordered.mjs", "second"] },
    ]);
    const report = await verify(repository);
    expect(report.verdict).toBe("PROVEN");
    expect(report.preparation?.commands.map((command) => command.stdout.trim())).toEqual([
      "step:first",
      "step:second",
    ]);
  });

  it("fails closed and does not run a second command after the first fails", async () => {
    await configure(repository, [
      { command: "node", args: ["fail.mjs"] },
      { command: "node", args: ["second.mjs"] },
    ]);
    const report = await verify(repository);
    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("failed with exit 7");
    expect(report.preparation?.commands).toHaveLength(1);
    expect(report.preparation?.commands[0]?.stderr).toContain("prepare:failed");
  });

  it("allows generated untracked build output", async () => {
    await configure(repository, [{ command: "node", args: ["build.mjs"] }]);
    const report = await verify(repository);
    expect(report.preparation?.passed).toBe(true);
    expect(report.preparation?.trackedFilesUnchanged).toBe(true);
    expect(report.verdict).toBe("PROVEN");
  });

  it("rejects preparation that modifies tracked source", async () => {
    await configure(repository, [{ command: "node", args: ["modify-tracked.mjs"] }]);
    const report = await verify(repository);
    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.preparation?.passed).toBe(false);
    expect(report.preparation?.trackedFilesUnchanged).toBe(false);
    expect(report.unverifiableReason).toContain("modified tracked files");
  });

  it("runs preparation only in the isolated checkout and leaves the supplied repository untouched", async () => {
    await configure(repository, [{ command: "node", args: ["build.mjs"] }]);
    const statusBefore = await git(repository.dir, "status", "--porcelain=v1");
    await verify(repository);
    expect(await git(repository.dir, "status", "--porcelain=v1")).toBe(statusBefore);
    await expect(access(join(repository.dir, "lib", "utils.js"))).rejects.toThrow();
    expect(statusBefore).toBe(originalStatus);
  });

  it("loads a project configuration without prepare", async () => {
    await configure(repository);
    await expect(loadProjectConfig(repository.dir)).resolves.toEqual({
      version: "1",
      language: "javascript",
      test: { command: "node", args: ["test.mjs"] },
    });
  });

  it("rejects a combined shell preparation command", async () => {
    await writeFile(join(repository.dir, ".portproof", "project.json"), JSON.stringify({
      version: "1",
      language: "javascript",
      prepare: [{ command: "npm ci && npm run build", args: [] }],
      test: { command: "node", args: ["test.mjs"] },
    }));
    await expect(loadProjectConfig(repository.dir)).rejects.toThrow(/one executable/);
  });
});
