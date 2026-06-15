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

function optionalEnv(name: string): string {
  return (process.env[name] || "").trim();
}

function requireEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return stripTrailingSlash(value);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function loadConfig(): DemoxConfig {
  const siteUrl = requireEnv("DEMOX_SITE_URL");
  const apiUrl = stripTrailingSlash(
    optionalEnv("DEMOX_API_URL") ||
    optionalEnv("DEMOX_CLOUD_FUNCTION_URL") ||
    optionalEnv("DEMOX_WEBSITE_API_URL")
  );
  if (!apiUrl) {
    throw new Error("Missing required environment variable: DEMOX_API_URL");
  }

  return {
    clientId: process.env.DEMOX_CLIENT_ID || "demox-mcp-client",
    siteUrl,
    authUrl: stripTrailingSlash(optionalEnv("DEMOX_AUTH_URL") || `${siteUrl}/#/mcp-authorize`),
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
