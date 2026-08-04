import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PACKAGE_NAME = "@demox-site/cli";

export type CommandRunner = (command: string, args: string[]) => Promise<{ stdout: string; stderr?: string }>;

export interface UpdateOptions {
  currentVersion: string;
  checkOnly?: boolean;
  force?: boolean;
  runCommand?: CommandRunner;
}

export interface UpdateResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  currentAhead: boolean;
  updated: boolean;
}

function parseVersion(version: string): { core: number[]; prerelease: string[] } {
  const match = String(version || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) throw new Error(`无法识别版本号: ${version}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : []
  };
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index++) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av === bv) continue;
    const an = /^\d+$/.test(av) ? Number(av) : null;
    const bn = /^\d+$/.test(bv) ? Number(bv) : null;
    if (an !== null && bn !== null) return an > bn ? 1 : -1;
    if (an !== null) return -1;
    if (bn !== null) return 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

const defaultRunner: CommandRunner = async (command, args) => {
  const result = await execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  return { stdout: result.stdout, stderr: result.stderr };
};

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export async function updateCli(options: UpdateOptions): Promise<UpdateResult> {
  const runCommand = options.runCommand || defaultRunner;
  const view = await runCommand(npmCommand(), ["view", `${PACKAGE_NAME}@latest`, "version", "--json"]);
  let latestVersion: string;
  try {
    const parsed = JSON.parse(view.stdout.trim());
    latestVersion = Array.isArray(parsed) ? String(parsed.at(-1) || "") : String(parsed || "");
    parseVersion(latestVersion);
  } catch (error) {
    throw new Error(`无法解析 npm 返回的最新版本: ${view.stdout.trim() || "空响应"}`);
  }

  const comparison = compareVersions(latestVersion, options.currentVersion);
  const updateAvailable = comparison > 0;
  const currentAhead = comparison < 0;
  const forceReinstall = !!options.force && comparison === 0;
  if (options.checkOnly || (!updateAvailable && !forceReinstall)) {
    return {
      currentVersion: options.currentVersion,
      latestVersion,
      updateAvailable,
      currentAhead,
      updated: false
    };
  }

  try {
    await runCommand(npmCommand(), ["install", "--global", `${PACKAGE_NAME}@latest`]);
  } catch (error: any) {
    const detail = String(error?.stderr || error?.message || error).trim();
    throw new Error(`CLI 更新失败: ${detail}`);
  }
  return {
    currentVersion: options.currentVersion,
    latestVersion,
    updateAvailable,
    currentAhead,
    updated: true
  };
}
