import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { initializeProjectConfig, loadProjectConfig } from "../src/core/project-config.js";
import { verifyRepository } from "../src/core/verify-repository.js";
import type { BackportProofReport } from "../src/core/types.js";

const exec = promisify(execFile);

interface TestRepository {
  dir: string;
  contractPath: string;
  metadataPath: string;
  sourceRef: string;
  brokenTarget: string;
  provenTarget: string;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await exec("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "PortProof Tests",
      GIT_AUTHOR_EMAIL: "tests@portproof.local",
      GIT_COMMITTER_NAME: "PortProof Tests",
      GIT_COMMITTER_EMAIL: "tests@portproof.local",
    },
  });
  return result.stdout.trim();
}

async function createTestRepository(): Promise<TestRepository> {
  const dir = await mkdtemp(join(tmpdir(), "portproof-generic-test-"));
  await git(dir, "init", "--initial-branch=main");
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "package.json"), '{"type":"module","scripts":{"test":"node test.mjs"}}\n');
  await writeFile(join(dir, "src", "module.js"), "export function publicValue() { return { value: 2 }; }\n");
  await writeFile(join(dir, "test.mjs"), "import assert from 'node:assert/strict'; assert.equal(typeof 2, 'number');\n");
  await git(dir, "add", "package.json", "src/module.js", "test.mjs");
  await git(dir, "commit", "-m", "initial target");
  await git(dir, "branch", "release/custom");

  await writeFile(join(dir, "src", "module.js"), "export function publicValue() { return { value: 1 }; }\n");
  await git(dir, "add", "src/module.js");
  await git(dir, "commit", "-m", "fix public value");
  const sourceSha = await git(dir, "rev-parse", "HEAD");
  await git(dir, "branch", "release/proven", sourceSha);

  await initializeProjectConfig(dir);
  await mkdir(join(dir, ".portproof", "proofs"), { recursive: true });
  const proofPath = join(dir, ".portproof", "proofs", "value.proof.mjs");
  await writeFile(
    proofPath,
    "import assert from 'node:assert/strict';\n" +
      "import { publicValue } from './src/module.js';\n" +
      "const observed = publicValue();\n" +
      "console.log(`PORTPROOF_OBSERVED ${JSON.stringify(observed)}`);\n" +
      "assert.deepEqual(observed, { value: 1 });\n"
  );
  const contractPath = join(dir, ".portproof", "behavior-contract.json");
  await writeFile(contractPath, JSON.stringify({
    version: "1",
    id: "generic-public-value",
    intent: "The public value remains one on the target branch.",
    observable: { setup: {}, operation: "publicValue", expected: { value: 1 } },
  }, null, 2));
  const metadataPath = join(dir, ".portproof", "executable-proof.json");
  await writeFile(metadataPath, JSON.stringify({
    version: "1",
    contractId: "generic-public-value",
    language: "javascript",
    file: ".portproof/proofs/value.proof.mjs",
    publicBoundary: { module: "src/module.js", export: "publicValue" },
    expected: { value: 1 },
  }, null, 2));
  await git(dir, "add", ".portproof");
  await git(dir, "commit", "-m", "add PortProof evidence");

  return {
    dir,
    contractPath,
    metadataPath,
    sourceRef: sourceSha,
    brokenTarget: "release/custom",
    provenTarget: "release/proven",
  };
}

async function verify(repo: TestRepository, targetRef: string): Promise<BackportProofReport> {
  return verifyRepository({
    repositoryPath: repo.dir,
    sourceRef: repo.sourceRef,
    targetRef,
    contractPath: repo.contractPath,
    proofMetadataPath: repo.metadataPath,
  });
}

describe("repository-oriented verification", () => {
  let repository: TestRepository;
  let statusBefore: string;
  let broken: BackportProofReport;
  let proven: BackportProofReport;

  beforeAll(async () => {
    repository = await createTestRepository();
    statusBefore = await git(repository.dir, "status", "--porcelain=v1");
    [broken, proven] = await Promise.all([
      verify(repository, repository.brokenTarget),
      verify(repository, repository.provenTarget),
    ]);
  });

  afterAll(async () => {
    await rm(repository.dir, { recursive: true, force: true });
  });

  it("accepts an arbitrary repository path and resolves source and target refs", () => {
    expect(broken.provenance?.repository).toMatch(/^portproof-generic-test-/);
    expect(broken.provenance?.source.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(broken.provenance?.target.ref).toBe("release/custom");
    expect(broken.provenance?.target.commitSha).toBe(broken.commitSha);
  });

  it("returns NOT_PROVEN for an arbitrary clean-but-wrong target branch", () => {
    expect(broken.verdict).toBe("NOT_PROVEN");
    expect(broken.mechanical.existingTests.passed).toBe(true);
    expect(broken.semantic.proof.observed).toEqual({ value: 2 });
  });

  it("returns PROVEN for an arbitrary target branch with the behavior", () => {
    expect(proven.verdict).toBe("PROVEN");
    expect(proven.semantic.proof.observed).toEqual({ value: 1 });
  });

  it("preserves exact immutable proof hashes", () => {
    const evidence = proven.evidence?.executableProof;
    expect(evidence?.sourceProofHash).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence?.copiedProofHash).toBe(evidence?.sourceProofHash);
    expect(evidence?.preExecutionProofHash).toBe(evidence?.sourceProofHash);
    expect(evidence?.postExecutionProofHash).toBe(evidence?.sourceProofHash);
    expect(broken.integrity?.proofHash).toBe(proven.integrity?.proofHash);
  });

  it("does not mutate the supplied source repository", async () => {
    expect(await git(repository.dir, "status", "--porcelain=v1")).toBe(statusBefore);
  });

  it("loads the strict generic project configuration", async () => {
    await expect(loadProjectConfig(repository.dir)).resolves.toEqual({
      version: "1",
      language: "javascript",
      test: { command: "npm", args: ["test"] },
    });
    expect(proven.provenance?.test).toEqual({ command: "npm", args: ["test"] });
  });

  it("fails closed for a nonexistent ref", async () => {
    const report = await verify(repository, "missing/ref");
    expect(report.verdict).toBe("UNVERIFIABLE");
    expect(report.unverifiableReason).toContain("could not be resolved");
  });

  it("fails closed for malformed project configuration", async () => {
    const original = await readFile(join(repository.dir, ".portproof", "project.json"), "utf8");
    await writeFile(join(repository.dir, ".portproof", "project.json"), "{not-json");
    try {
      const report = await verify(repository, repository.provenTarget);
      expect(report.verdict).toBe("UNVERIFIABLE");
      expect(report.unverifiableReason).toContain("invalid JSON");
    } finally {
      await writeFile(join(repository.dir, ".portproof", "project.json"), original);
    }
  });

  it("fails closed for an unsupported language", async () => {
    const path = join(repository.dir, ".portproof", "project.json");
    const original = await readFile(path, "utf8");
    await writeFile(path, JSON.stringify({
      version: "1",
      language: "python",
      test: { command: "npm", args: ["test"] },
    }));
    try {
      const report = await verify(repository, repository.provenTarget);
      expect(report.verdict).toBe("UNVERIFIABLE");
      expect(report.unverifiableReason).toMatch(/language|configuration/i);
    } finally {
      await writeFile(path, original);
    }
  });
});

describe("project initialization", () => {
  it("does not overwrite configuration without explicit force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "portproof-init-test-"));
    try {
      const path = await initializeProjectConfig(dir);
      await expect(initializeProjectConfig(dir)).rejects.toThrow(/--force/);
      await initializeProjectConfig(dir, { overwrite: true });
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
        version: "1",
        language: "javascript",
        test: { command: "npm", args: ["test"] },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an interpolated command string in place of executable and args", async () => {
    const dir = await mkdtemp(join(tmpdir(), "portproof-config-test-"));
    try {
      await mkdir(join(dir, ".portproof"), { recursive: true });
      await writeFile(join(dir, ".portproof", "project.json"), JSON.stringify({
        version: "1",
        language: "javascript",
        test: { command: "npm test", args: [] },
      }));
      await expect(loadProjectConfig(dir)).rejects.toThrow(/one executable/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
