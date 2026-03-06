/**
 * 配置管理模块
 */

import os from "os";
import path from "path";

export interface DemoxConfig {
  clientId: string;
  authUrl: string;
  apiBase: string;
  cloudFunctionUrl: string;
}

export function loadConfig(): DemoxConfig {
  return {
    clientId: process.env.DEMOX_CLIENT_ID || "demox-mcp-client",
    authUrl: process.env.DEMOX_AUTH_URL || "https://demox.site/#/mcp-authorize",
    apiBase: process.env.DEMOX_API_BASE || "https://demox.site",
    cloudFunctionUrl:
      process.env.DEMOX_CLOUD_FUNCTION_URL ||
      "https://1307257815-ju8ahprgj9.ap-guangzhou.tencentscf.com",
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
