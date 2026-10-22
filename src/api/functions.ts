/**
 * Site cloud-function helpers (ported from @demox-site/sdk 0.1.1).
 */

import { existsSync, promises as fs, statSync } from "node:fs";
import path from "node:path";
import { AuthError } from "./errors.js";

const ALLOWED_ENTRYPOINTS = new Set(["index.js", "index.cjs", "index.mjs"]);
const AUTH_ERROR_CODES = new Set([
  "TOKEN_INVALID",
  "AUTH_REQUIRED",
  "AUTH_ERROR",
  "UNAUTHORIZED",
  "TOKEN_EXPIRED",
  "NEED_LOGIN",
]);

export interface SiteFunction {
  functionId: string;
  websiteId?: string;
  name: string;
  slug: string;
  status?: string;
  runtime: string;
  publishedVersion: number | null;
  routes: string[];
  triggers: string[];
  timerName: string | null;
  aliases: Array<{ alias: string; version: number }>;
  invokeUrl: string | null;
  editable: boolean;
}

export interface PushFunctionParams {
  websiteId: string;
  slug: string;
  name?: string;
  source: string;
  entrypoint?: string;
  routes?: string[];
  triggers?: string[];
  timerName?: string | null;
  runtime?: string;
  envName?: string;
}

export interface PushFunctionResult {
  functionId: string;
  websiteId: string;
  slug: string;
  name: string;
  created: boolean;
  version: number;
  publishedVersion: number | null;
  invokeUrl: string | null;
  aliases: Array<{ alias: string; version: number }>;
  entrypoint: string;
}

function functionEnvName(envName?: string): string {
  return String(envName || process.env.DEMOX_FUNCTION_ENV || "production").trim() || "production";
}

export function scopedFunctionsPath(websiteId: string, envName?: string): string {
  return `/${encodeURIComponent(websiteId)}/${encodeURIComponent(functionEnvName(envName))}/functions`;
}

export function scopedApiPath(websiteId: string, slug: string, envName?: string): string {
  return `/${encodeURIComponent(websiteId)}/${encodeURIComponent(functionEnvName(envName))}/api/${encodeURIComponent(slug)}`;
}

export function parseEnvAssignments(values: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of values) {
    const line = String(raw || "").trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.replace(/^export\s+/, "");
    const index = stripped.indexOf("=");
    if (index <= 0) throw new Error(`环境变量格式必须是 KEY=value: ${line}`);
    const key = stripped.slice(0, index).trim().toUpperCase();
    let value = stripped.slice(index + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export async function readEnvFile(filePath: string): Promise<Record<string, string>> {
  const textValue = await fs.readFile(filePath, "utf8");
  return parseEnvAssignments(textValue.split(/\r?\n/));
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? (value as Record<string, any>) : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function normalizeSiteFunction(value: unknown): SiteFunction {
  const row = asRecord(value);
  const routes = Array.isArray(row.routes) ? row.routes.map((item) => String(item)) : [];
  const triggers = Array.isArray(row.triggers) ? row.triggers.map((item) => String(item)) : [];
  return {
    functionId: text(row.functionId),
    websiteId: text(row.websiteId) || undefined,
    name: text(row.name),
    slug: text(row.slug),
    status: text(row.status) || undefined,
    runtime: text(row.runtime) || "nodejs",
    publishedVersion:
      row.publishedVersion == null || row.publishedVersion === ""
        ? null
        : Number(row.publishedVersion),
    routes,
    triggers,
    timerName: row.timerName == null ? null : text(row.timerName),
    aliases: Array.isArray(row.aliases)
      ? row.aliases.map((item) => {
          const alias = asRecord(item);
          return { alias: text(alias.alias), version: Number(alias.version) };
        })
      : [],
    invokeUrl: row.invokeUrl == null ? null : text(row.invokeUrl),
    editable: row.editable !== false,
  };
}

export async function resolveFunctionSource(
  input: string,
  entrypoint?: string
): Promise<{ source: string; entrypoint: string; filePath: string }> {
  const resolved = path.resolve(input);
  let stat;
  try {
    stat = statSync(resolved);
  } catch {
    throw new Error(`路径不存在: ${input}`);
  }
  if (stat.isFile()) {
    const name = entrypoint || path.basename(resolved);
    const normalized = ALLOWED_ENTRYPOINTS.has(name) ? name : "index.js";
    return {
      source: await fs.readFile(resolved, "utf8"),
      entrypoint: normalized,
      filePath: resolved,
    };
  }
  if (!stat.isDirectory()) throw new Error(`不支持的路径: ${input}`);
  const candidates = entrypoint ? [entrypoint] : ["index.js", "index.cjs", "index.mjs"];
  const filePath = candidates
    .map((name) => path.join(resolved, name))
    .find((candidate) => existsSync(candidate));
  if (!filePath) {
    throw new Error("目录里没有 index.js / index.cjs / index.mjs，请用 --entrypoint 指定入口文件");
  }
  const name = path.basename(filePath);
  if (!ALLOWED_ENTRYPOINTS.has(name)) {
    throw new Error(`入口文件必须是 index.js、index.cjs 或 index.mjs，当前是 ${name}`);
  }
  return { source: await fs.readFile(filePath, "utf8"), entrypoint: name, filePath };
}

async function requestJson(options: {
  baseUrl: string;
  path: string;
  method?: string;
  body?: unknown;
  accessToken?: string;
  fetchImpl?: typeof fetch;
}): Promise<any> {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${options.baseUrl.replace(/\/+$/, "")}${options.path}`, {
    method: options.method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const raw = await response.text();
  let data: any = raw;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      /* keep raw */
    }
  }
  const row = asRecord(data);
  const errorValue = row.error;
  const error = asRecord(errorValue);
  const code = text(error.code) || text(row.code);
  const message =
    text(error.message) ||
    text(row.message) ||
    (typeof errorValue === "string" ? errorValue : "");
  const serialized = typeof data === "string" ? data : JSON.stringify(data);
  const isAuth =
    response.status === 401 ||
    AUTH_ERROR_CODES.has(code) ||
    /UNAUTHORIZED|TOKEN_INVALID|AUTH_REQUIRED/.test(serialized);
  if (isAuth) throw new AuthError(message || "Token 已过期或无效，需要重新登录");
  if (response.status < 200 || response.status >= 300) {
    throw new Error(message || `HTTP ${response.status}: ${serialized}`);
  }
  if (errorValue) throw new Error(message || "请求失败");
  if (row.success === false) throw new Error(message || "请求失败");
  return data;
}

export function createFunctionApi(options: { apiUrl: string; fetchImpl?: typeof fetch }) {
  const apiUrl = options.apiUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl || fetch;
  const call = (
    pathName: string,
    init: { method?: string; body?: unknown; accessToken?: string }
  ) =>
    requestJson({
      baseUrl: apiUrl,
      path: pathName,
      method: init.method || "POST",
      body: init.body,
      accessToken: init.accessToken,
      fetchImpl,
    });

  return {
    async listFunctions(websiteId: string, accessToken: string, envName?: string) {
      const result = await call(scopedFunctionsPath(websiteId, envName), {
        method: "GET",
        accessToken,
      });
      return (result.functions || []).map(normalizeSiteFunction);
    },

    async createFunction(
      params: {
        websiteId: string;
        name: string;
        slug: string;
        runtime?: string;
        routes?: string[];
        triggers?: string[];
        timerName?: string | null;
        envName?: string;
      },
      accessToken: string
    ) {
      const result = await call(scopedFunctionsPath(params.websiteId, params.envName), {
        method: "POST",
        accessToken,
        body: {
          websiteId: params.websiteId,
          name: params.name,
          slug: params.slug,
          runtime: params.runtime || "nodejs",
          routes: params.routes,
          triggers: params.triggers,
          timerName: params.timerName,
        },
      });
      return normalizeSiteFunction(result.function);
    },

    async createFunctionVersion(
      functionId: string,
      params: { source: string; entrypoint?: string },
      accessToken: string
    ) {
      const result = await call(`/functions/${encodeURIComponent(functionId)}/versions`, {
        method: "POST",
        accessToken,
        body: {
          source: params.source,
          entrypoint: params.entrypoint || "index.js",
        },
      });
      const version = asRecord(result.version);
      return {
        version: Number(version.version),
        status: text(version.status) || undefined,
        sha256: text(version.sha256) || undefined,
        sizeBytes: version.sizeBytes == null ? undefined : Number(version.sizeBytes),
        entrypoint: text(version.entrypoint) || params.entrypoint || "index.js",
      };
    },

    async pushFunction(params: PushFunctionParams, accessToken: string): Promise<PushFunctionResult> {
      const entrypoint = params.entrypoint || "index.js";
      const listed = await this.listFunctions(params.websiteId, accessToken, params.envName);
      let record = listed.find((item: SiteFunction) => item.slug === params.slug);
      let created = false;
      if (!record) {
        record = await this.createFunction(
          {
            websiteId: params.websiteId,
            name: params.name || params.slug,
            slug: params.slug,
            runtime: params.runtime || "nodejs",
            routes: params.routes,
            triggers: params.triggers,
            timerName: params.timerName,
            envName: params.envName,
          },
          accessToken
        );
        created = true;
      }
      const version = await this.createFunctionVersion(
        record.functionId,
        { source: params.source, entrypoint },
        accessToken
      );
      const listedAfter = await this.listFunctions(params.websiteId, accessToken, params.envName);
      const current =
        listedAfter.find((item: SiteFunction) => item.functionId === record!.functionId) ||
        record;
      return {
        functionId: current.functionId,
        websiteId: current.websiteId || params.websiteId,
        slug: current.slug || params.slug,
        name: current.name || record.name,
        created,
        version: version.version,
        publishedVersion: current.publishedVersion || version.version,
        invokeUrl: current.invokeUrl,
        aliases: current.aliases || [],
        entrypoint,
      };
    },

    async getFunctionEnv(functionId: string, accessToken: string) {
      const result = await call(`/functions/${encodeURIComponent(functionId)}/env`, {
        method: "GET",
        accessToken,
      });
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(result.env || {})) {
        if (typeof value === "string") env[key] = value;
      }
      return env;
    },

    async putFunctionEnv(
      functionId: string,
      env: Record<string, string>,
      accessToken: string
    ) {
      const result = await call(`/functions/${encodeURIComponent(functionId)}/env`, {
        method: "POST",
        accessToken,
        body: { env },
      });
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(result.env || {})) {
        if (typeof value === "string") next[key] = value;
      }
      return next;
    },

    async listAliases(functionId: string, accessToken: string) {
      const result = await call(`/functions/${encodeURIComponent(functionId)}/aliases`, {
        method: "GET",
        accessToken,
      });
      return (result.aliases || []).map((item: any) => ({
        alias: String(item.alias || ""),
        version: Number(item.version),
      }));
    },

    async setAlias(
      functionId: string,
      alias: string,
      version: number,
      accessToken: string
    ) {
      const result = await call(
        `/functions/${encodeURIComponent(functionId)}/aliases/${encodeURIComponent(alias)}`,
        { method: "POST", accessToken, body: { version } }
      );
      return {
        alias: String(result.alias?.alias || alias),
        version: Number(result.alias?.version || version),
      };
    },

    async deleteAlias(functionId: string, alias: string, accessToken: string) {
      await call(
        `/functions/${encodeURIComponent(functionId)}/aliases/${encodeURIComponent(alias)}`,
        { method: "DELETE", accessToken }
      );
    },

    async invokeSiteFunction(params: {
      websiteId: string;
      slug: string;
      method?: string;
      body?: unknown;
      envName?: string;
      accessToken?: string;
    }) {
      const pathName = scopedApiPath(params.websiteId, params.slug, params.envName);
      const method = String(params.method || "POST").toUpperCase();
      const response = await fetchImpl(`${apiUrl}${pathName}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(params.accessToken ? { Authorization: `Bearer ${params.accessToken}` } : {}),
        },
        body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(params.body ?? {}),
      });
      const raw = await response.text();
      let parsed: unknown = raw;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
      }
      return { status: response.status, body: parsed };
    },
  };
}
