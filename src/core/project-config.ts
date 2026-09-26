import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { PortProofProjectConfig } from "./types.js";

const nonBlank = (field: string) =>
  z.string().refine((value) => value.trim().length > 0, {
    message: `${field} must be a non-empty string`,
  });

export const projectConfigSchema: z.ZodType<PortProofProjectConfig> = z.strictObject({
  version: z.literal("1"),
  language: z.literal("javascript", {
    error: "language must be javascript; no other adapter ships in this release",
  }),
  test: z.strictObject({
    command: nonBlank("test.command")
      .refine((value) => !value.includes("\0"), {
        message: "test.command must not contain NUL bytes",
      })
      .refine((value) => !/\s/.test(value), {
        message: "test.command must contain one executable; put command arguments in test.args",
      }),
    args: z.array(z.string().refine((value) => !value.includes("\0"), {
      message: "test arguments must not contain NUL bytes",
    })),
  }),
});

export const DEFAULT_PROJECT_CONFIG: PortProofProjectConfig = {
  version: "1",
  language: "javascript",
  test: { command: "npm", args: ["test"] },
};

export class ProjectConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectConfigError";
  }
}

export function projectConfigPath(repositoryPath: string): string {
  return join(resolve(repositoryPath), ".portproof", "project.json");
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "project"}: ${issue.message}`)
    .join("; ");
}

export async function loadProjectConfig(repositoryPath: string): Promise<PortProofProjectConfig> {
  const path = projectConfigPath(repositoryPath);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new ProjectConfigError(`Project configuration could not be read: ${String(error)}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ProjectConfigError(`Project configuration contains invalid JSON: ${String(error)}`);
  }

  const result = projectConfigSchema.safeParse(value);
  if (!result.success) {
    throw new ProjectConfigError(`Project configuration schema validation failed: ${formatIssues(result.error)}`);
  }
  return result.data;
}

export async function initializeProjectConfig(
  repositoryPath: string,
  options: { overwrite?: boolean } = {}
): Promise<string> {
  const path = projectConfigPath(repositoryPath);
  await mkdir(join(resolve(repositoryPath), ".portproof"), { recursive: true });
  try {
    await writeFile(path, `${JSON.stringify(DEFAULT_PROJECT_CONFIG, null, 2)}\n`, {
      encoding: "utf8",
      flag: options.overwrite === true ? "w" : "wx",
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new ProjectConfigError(
        `Project configuration already exists at ${path}; pass --force to replace it explicitly.`
      );
    }
    throw new ProjectConfigError(`Project configuration could not be created: ${String(error)}`);
  }
  return path;
}
