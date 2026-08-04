/**
 * 配置管理模块
 */

import os from "os";
import path from "path";

export interface DemoxConfig {
  clientId: string;
  siteUrl: string;
  authUrl: string;
  apiBase: string;
  cloudFunctionUrl: string;
  websiteApiUrl: string;
}

const DEFAULT_CLIENT_ID = "demox-mcp-client";
const DEFAULT_SITE_URL = "https://www.demox.site";
const DEFAULT_API_URL = "https://api.demox.site";

function optionalEnv(name: string): string {
  return (process.env[name] || "").trim();
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function defaultAuthUrl(siteUrl: string): string {
  const authSiteUrl = siteUrl === "https://demox.site"
    ? DEFAULT_SITE_URL
    : siteUrl;
  return `${authSiteUrl}/mcp-authorize`;
}

export function loadConfig(): DemoxConfig {
  const siteUrl = stripTrailingSlash(optionalEnv("DEMOX_SITE_URL") || DEFAULT_SITE_URL);
  const apiUrl = stripTrailingSlash(
    optionalEnv("DEMOX_API_URL") ||
    optionalEnv("DEMOX_CLOUD_FUNCTION_URL") ||
    optionalEnv("DEMOX_WEBSITE_API_URL") ||
    DEFAULT_API_URL
  );

  return {
    clientId: optionalEnv("DEMOX_CLIENT_ID") || DEFAULT_CLIENT_ID,
    siteUrl,
    authUrl: stripTrailingSlash(optionalEnv("DEMOX_AUTH_URL") || defaultAuthUrl(siteUrl)),
    apiBase: stripTrailingSlash(optionalEnv("DEMOX_API_BASE") || siteUrl),
    cloudFunctionUrl: stripTrailingSlash(optionalEnv("DEMOX_CLOUD_FUNCTION_URL") || apiUrl),
    websiteApiUrl: stripTrailingSlash(optionalEnv("DEMOX_WEBSITE_API_URL") || apiUrl),
  };
}

/**
 * Token 存储路径
 */
export function getTokenPath(): string {
  return path.join(os.homedir(), ".demox", "token.json");
}

/**
 * 配置目录路径
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), ".demox");
}
