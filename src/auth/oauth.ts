/**
 * OAuth 认证管理器
 */

import http from "http";
import { URL } from "url";
import open from "open";
import { promises as fs } from "fs";
import { existsSync } from "fs";
import { dirname } from "path";
import { loadConfig, getTokenPath } from "../utils/config.js";
import { logger } from "../utils/logger.js";

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  userId: string;
  clientId: string;
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
   * 启动 OAuth 授权流程
   */
  async authorize(): Promise<string> {
    logger.info("正在启动登录流程...");

    const state = this.generateRandomState();
    const params = new URLSearchParams();
    params.set("client_id", this.config.clientId);
    params.set("redirect_uri", "http://localhost:39897/callback");
    params.set("response_type", "code");
    params.set("state", state);
    params.set("scope", "website:deploy website:list website:delete website:update");

    const authUrl = `${this.config.authUrl}?${params.toString()}`;

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
        this.startLocalServer(state),
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
   * 启动本地 HTTP 服务器接收回调
   */
  private startLocalServer(expectedState: string): Promise<TokenData> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || "", `http://${req.headers.host}`);
        const accessToken = url.searchParams.get("access_token");
        const refreshToken = url.searchParams.get("refresh_token");
        const userId = url.searchParams.get("user_id");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>登录取消</title><meta charset="utf-8">
            <style>body { font-family: sans-serif; text-align: center; padding: 50px; }.error { color: #ef4444; font-size: 24px; }</style>
            </head>
            <body><div class="error">❌ 登录取消</div><p>${error}</p><p>您可以关闭此页面。</p></body>
            </html>
          `);
          server.close();
          reject(new Error(`OAuth 授权失败: ${error}`));
          return;
        }

        if (accessToken && state) {
          if (state !== expectedState) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end("State 不匹配");
            server.close();
            reject(new Error("OAuth state 不匹配"));
            return;
          }

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>登录成功</title><meta charset="utf-8">
            <style>body { font-family: sans-serif; text-align: center; padding: 50px; }.success { color: #10b981; font-size: 24px; }</style>
            </head>
            <body><div class="success">✅ 登录成功！</div><p>您可以关闭此页面了。</p></body>
            </html>
          `);

          server.close();

          const tokenData: TokenData = {
            accessToken,
            refreshToken: refreshToken || accessToken,
            expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
            scopes: ["website:deploy", "website:list", "website:delete", "website:update"],
            userId: userId || "",
            clientId: this.config.clientId,
          };

          resolve(tokenData);
        } else {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("缺少必要的参数");
          server.close();
          reject(new Error("缺少必要的 OAuth 参数"));
        }
      });

      server.listen(39897, () => {
        logger.debug("本地服务器已启动，监听端口 39897");
      });

      setTimeout(() => {
        server.close();
        reject(new Error("登录超时（5 分钟）"));
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
   * 生成随机 state
   */
  private generateRandomState(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
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
