/**
 * OAuth 认证管理器（authorization code + PKCE S256）
 */

import http from "http";
import { URL } from "url";
import open from "open";
import { promises as fs } from "fs";
import { existsSync } from "fs";
import { dirname } from "path";
import { randomBytes } from "crypto";
import { loadConfig, getTokenPath } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { createPkcePair } from "./pkce.js";

export const OAUTH_REDIRECT_URI = "http://localhost:39897/callback";
export const OAUTH_CALLBACK_PORT = 39897;
export const OAUTH_DEFAULT_SCOPES = [
  "website:deploy",
  "website:list",
  "website:delete",
  "website:update",
] as const;

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  userId: string;
  clientId: string;
}

export interface AuthorizeUrlOptions {
  clientId: string;
  authUrl: string;
  state: string;
  codeChallenge: string;
  scope?: string;
  redirectUri?: string;
}

/** Build the browser authorize URL (includes required PKCE S256 params). */
export function buildAuthorizeUrl(options: AuthorizeUrlOptions): string {
  const params = new URLSearchParams();
  params.set("client_id", options.clientId);
  params.set("redirect_uri", options.redirectUri || OAUTH_REDIRECT_URI);
  params.set("response_type", "code");
  params.set("state", options.state);
  params.set(
    "scope",
    options.scope || OAUTH_DEFAULT_SCOPES.join(" ")
  );
  params.set("code_challenge", options.codeChallenge);
  params.set("code_challenge_method", "S256");

  const base = options.authUrl.replace(/\?$/, "");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${params.toString()}`;
}

export class OAuthManager {
  private config: ReturnType<typeof loadConfig>;
  private tokenPath: string;
  private currentToken: TokenData | null = null;

  constructor() {
    this.config = loadConfig();
    this.tokenPath = getTokenPath();
  }

  /**
   * 确保已认证
   */
  async ensureAuthenticated(): Promise<string> {
    // CI/非交互环境：直接用环境变量里的长期 token，跳过 OAuth 与本地文件
    const envToken = process.env.DEMOX_TOKEN;
    if (envToken && envToken.trim()) {
      logger.debug("使用 DEMOX_TOKEN 环境变量中的 Token");
      return envToken.trim();
    }

    const tokenData = await this.loadToken();

    if (tokenData && !this.isTokenExpired(tokenData)) {
      this.currentToken = tokenData;
      logger.debug("使用本地缓存的 Token");

      const daysLeft = Math.floor(
        (tokenData.expiresAt - Date.now()) / (1000 * 60 * 60 * 24)
      );
      if (daysLeft <= 3) {
        logger.warn(`Token 将在 ${daysLeft} 天后过期，建议重新登录`);
      }

      return tokenData.accessToken;
    }

    logger.info("Token 不存在或已过期，需要登录");
    return await this.authorize();
  }

  /**
   * 启动 OAuth 授权流程（authorization code + PKCE）
   */
  async authorize(): Promise<string> {
    logger.info("正在启动登录流程...");

    const state = this.generateRandomState();
    const { verifier, challenge } = createPkcePair();
    const authUrl = buildAuthorizeUrl({
      clientId: this.config.clientId,
      authUrl: this.config.authUrl,
      state,
      codeChallenge: challenge,
    });

    console.log("\n" + "=".repeat(70));
    console.log("🔐 请在浏览器中访问以下 URL 完成登录：");
    console.log("=".repeat(70));
    console.log("\n" + authUrl + "\n");
    console.log("=".repeat(70));
    console.log("💡 提示：复制上面的 URL 到浏览器中打开");
    console.log("⏳ 等待您在浏览器中完成登录...\n");

    try {
      await open(authUrl);
    } catch {
      logger.debug("无法自动打开浏览器，请手动访问上述 URL");
    }

    try {
      const tokenData = await Promise.race([
        this.startLocalServer(state, verifier),
        this.createTimeout(300000),
      ]);

      await this.saveToken(tokenData);

      logger.success("登录成功！");
      console.log(`Token 已保存到: ${this.tokenPath}\n`);

      return tokenData.accessToken;
    } catch (error: any) {
      logger.error("登录失败: " + error.message);
      throw error;
    }
  }

  /**
   * 用授权码 + code_verifier 向 api.demox.site 换 token
   */
  async exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
    redirectUri: string = OAUTH_REDIRECT_URI
  ): Promise<TokenData> {
    const tokenUrl = `${this.config.cloudFunctionUrl}/oauth/token`;
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: this.config.clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier,
      }),
    });

    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`换取 Token 失败（HTTP ${response.status}）：响应不是 JSON`);
    }

    if (!response.ok) {
      const description =
        (typeof body.error_description === "string" && body.error_description) ||
        (typeof body.message === "string" && body.message) ||
        (typeof body.error === "string" && body.error) ||
        `HTTP ${response.status}`;
      throw new Error(`换取 Token 失败: ${description}`);
    }

    const accessToken = body.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new Error("换取 Token 失败: 响应缺少 access_token");
    }

    const expiresIn =
      typeof body.expires_in === "number" && body.expires_in > 0
        ? body.expires_in
        : 3600;
    const refreshToken =
      typeof body.refresh_token === "string" && body.refresh_token
        ? body.refresh_token
        : accessToken;
    const scopes =
      typeof body.scope === "string" && body.scope.trim()
        ? body.scope.trim().split(/\s+/).filter(Boolean)
        : [...OAUTH_DEFAULT_SCOPES];
    const userId = typeof body.user_id === "string" ? body.user_id : "";

    return {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      scopes,
      userId,
      clientId: this.config.clientId,
    };
  }

  /**
   * 启动本地 HTTP 服务器接收回调。
   * 优先 authorization code + PKCE；仍兼容旧的 access_token 查询串（若服务端偶发返回）。
   */
  private startLocalServer(
    expectedState: string,
    codeVerifier: string
  ): Promise<TokenData> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err: Error | null, token?: TokenData) => {
        if (settled) return;
        settled = true;
        try {
          server.close();
        } catch {
          /* ignore */
        }
        if (err) reject(err);
        else resolve(token!);
      };

      const server = http.createServer((req, res) => {
        void (async () => {
          const url = new URL(req.url || "", `http://${req.headers.host}`);
          const code = url.searchParams.get("code");
          const accessToken = url.searchParams.get("access_token");
          const refreshToken = url.searchParams.get("refresh_token");
          const userId = url.searchParams.get("user_id");
          const state = url.searchParams.get("state");
          const error = url.searchParams.get("error");
          const errorDescription = url.searchParams.get("error_description");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(htmlPage("登录取消", "error", errorDescription || error));
            finish(new Error(`OAuth 授权失败: ${errorDescription || error}`));
            return;
          }

          if (!state) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end("缺少 state");
            finish(new Error("缺少必要的 OAuth 参数"));
            return;
          }

          if (state !== expectedState) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end("State 不匹配");
            finish(new Error("OAuth state 不匹配"));
            return;
          }

          // Preferred path: authorization code → token endpoint with PKCE verifier
          if (code) {
            try {
              const tokenData = await this.exchangeAuthorizationCode(
                code,
                codeVerifier
              );
              res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
              res.end(htmlPage("登录成功！", "success", "您可以关闭此页面了。"));
              finish(null, tokenData);
            } catch (exchangeError: any) {
              const message = exchangeError?.message || "换取 Token 失败";
              res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
              res.end(htmlPage("登录失败", "error", message));
              finish(new Error(message));
            }
            return;
          }

          // Legacy compatibility: implicit-style access_token in the query string
          if (accessToken) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(htmlPage("登录成功！", "success", "您可以关闭此页面了。"));
            finish(null, {
              accessToken,
              refreshToken: refreshToken || accessToken,
              expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
              scopes: [...OAUTH_DEFAULT_SCOPES],
              userId: userId || "",
              clientId: this.config.clientId,
            });
            return;
          }

          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("缺少必要的参数");
          finish(new Error("缺少必要的 OAuth 参数"));
        })();
      });

      server.on("error", (err) => {
        finish(err instanceof Error ? err : new Error(String(err)));
      });

      server.listen(OAUTH_CALLBACK_PORT, () => {
        logger.debug(`本地服务器已启动，监听端口 ${OAUTH_CALLBACK_PORT}`);
      });

      setTimeout(() => {
        finish(new Error("登录超时（5 分钟）"));
      }, 300000);
    });
  }

  /**
   * 从本地加载 Token
   */
  async loadToken(): Promise<TokenData | null> {
    try {
      if (!existsSync(this.tokenPath)) {
        return null;
      }

      const content = await fs.readFile(this.tokenPath, "utf-8");
      const tokenData = JSON.parse(content);

      if (!tokenData.accessToken) {
        return null;
      }

      return tokenData;
    } catch {
      return null;
    }
  }

  /**
   * 保存 Token 到本地
   */
  private async saveToken(tokenData: TokenData): Promise<void> {
    const dir = dirname(this.tokenPath);

    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(this.tokenPath, JSON.stringify(tokenData, null, 2), "utf-8");
    this.currentToken = tokenData;
  }

  /**
   * 检查 Token 是否过期
   */
  private isTokenExpired(tokenData: TokenData): boolean {
    return Date.now() >= tokenData.expiresAt - 5 * 60 * 1000;
  }

  /**
   * 生成随机 state（auth-api 要求 16–128 位 [A-Za-z0-9._~-]）
   */
  private generateRandomState(): string {
    return randomBytes(24).toString("base64url");
  }

  /**
   * 创建超时 Promise
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error("操作超时")), ms);
    });
  }

  /**
   * 删除本地 Token
   */
  async revokeToken(): Promise<void> {
    if (existsSync(this.tokenPath)) {
      await fs.unlink(this.tokenPath);
    }
    this.currentToken = null;
  }
}

function htmlPage(
  title: string,
  kind: "success" | "error",
  detail: string
): string {
  const color = kind === "success" ? "#10b981" : "#ef4444";
  const icon = kind === "success" ? "✅" : "❌";
  const escaped = String(detail)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html>
<head><title>${title}</title><meta charset="utf-8">
<style>body { font-family: sans-serif; text-align: center; padding: 50px; }.msg { color: ${color}; font-size: 24px; }</style>
</head>
<body><div class="msg">${icon} ${title}</div><p>${escaped}</p></body>
</html>`;
}
