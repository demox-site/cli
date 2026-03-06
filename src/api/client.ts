/**
 * Demox API 客户端
 */

import { loadConfig } from "../utils/config.js";
import { logger } from "../utils/logger.js";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface DeployParams {
  zipFile: string;
  websiteId?: string;
  fileName: string;
}

export interface DeployResult {
  url: string;
  websiteId: string;
  path: string;
}

export interface Website {
  websiteId: string;
  fileName: string;
  url: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export class DemoxClient {
  private apiUrl: string;

  constructor() {
    const config = loadConfig();
    this.apiUrl = config.cloudFunctionUrl;
  }

  /**
   * 调用 API
   */
  private async callApi(
    path: string,
    data: Record<string, any>,
    accessToken: string
  ): Promise<any> {
    const https = await import("https");
    const urlModule = await import("url");

    try {
      logger.debug(`调用 API: ${path}`);

      const urlObj = new urlModule.URL(this.apiUrl + path);
      const requestBodyStr = JSON.stringify(data);

      const responseData = await new Promise<any>((resolve, reject) => {
        const req = https.request(
          {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${accessToken}`,
              "Content-Length": Buffer.byteLength(requestBodyStr),
            },
          },
          (res: any) => {
            let body = "";
            res.on("data", (chunk: any) => (body += chunk));
            res.on("end", () => {
              try {
                const jsonResponse = JSON.parse(body);
                resolve({
                  ok: res.statusCode && res.statusCode >= 200 && res.statusCode < 300,
                  status: res.statusCode,
                  data: jsonResponse,
                });
              } catch {
                resolve({
                  ok: res.statusCode && res.statusCode >= 200 && res.statusCode < 300,
                  status: res.statusCode,
                  data: body,
                });
              }
            });
          }
        );

        req.on("error", (err: Error) => reject(new Error(`请求失败: ${err.message}`)));
        req.write(requestBodyStr);
        req.end();
      });

      if (!responseData.ok) {
        const errorText = typeof responseData.data === "string"
          ? responseData.data
          : JSON.stringify(responseData.data);

        if (
          responseData.status === 401 ||
          errorText.includes("UNAUTHORIZED") ||
          errorText.includes("TOKEN_INVALID") ||
          errorText.includes("AUTH_REQUIRED")
        ) {
          throw new AuthError("Token 已过期或无效，需要重新登录");
        }

        throw new Error(`HTTP ${responseData.status}: ${errorText}`);
      }

      if (responseData.data && responseData.data.error) {
        const error = responseData.data.error;
        const authErrorCodes = [
          "TOKEN_INVALID",
          "AUTH_REQUIRED",
          "AUTH_ERROR",
          "UNAUTHORIZED",
          "TOKEN_EXPIRED",
          "NEED_LOGIN",
        ];

        if (authErrorCodes.includes(error.code)) {
          throw new AuthError(error.message || "Token 已过期或无效");
        }

        throw new Error(
          `[${error.code}] ${error.message}${error.suggestion ? `\n建议：${error.suggestion}` : ""}`
        );
      }

      return responseData.data;
    } catch (error: any) {
      if (error instanceof AuthError) throw error;
      logger.error(`API调用失败 (${path}): ${error.message}`);
      throw error;
    }
  }

  /**
   * 部署网站
   */
  async deployWebsite(params: DeployParams, accessToken: string): Promise<DeployResult> {
    let websiteId = params.websiteId;
    if (!websiteId) {
      websiteId = this.generateWebsiteId();
      logger.debug(`自动生成 websiteId: ${websiteId}`);
    }

    logger.info(`正在部署网站: ${params.fileName}`);

    let localFilePath: string | null = null;

    if (params.zipFile.startsWith("http://") || params.zipFile.startsWith("https://")) {
      if (!params.zipFile.toLowerCase().endsWith(".zip")) {
        throw new Error(`只支持 ZIP 文件，URL 必须以 .zip 结尾`);
      }

      logger.debug("检测到 ZIP URL，正在下载...");
      const buffer = await this.downloadZipFileToBuffer(params.zipFile);
      localFilePath = await this.saveBufferToTempFile(buffer);
    } else {
      logger.debug(`检测到本地路径: ${params.zipFile}`);

      const stat = await this.getPathStat(params.zipFile);
      if (stat.isDirectory) {
        logger.debug(`检测到目录: ${params.zipFile}，正在打包...`);
        localFilePath = await this.zipDirectoryToFile(params.zipFile);
      } else if (params.zipFile.toLowerCase().endsWith(".zip")) {
        localFilePath = params.zipFile;
      } else {
        throw new Error(`不支持的文件类型，仅支持 .zip 文件或目录`);
      }
    }

    if (!localFilePath) {
      throw new Error(`无法处理输入文件`);
    }

    const fileSize = await this.getFileSize(localFilePath);
    logger.info(`文件大小: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);

    const maxFileSize = 8 * 1024 * 1024;
    if (fileSize > maxFileSize) {
      throw new Error(`文件过大 (${(fileSize / 1024 / 1024).toFixed(2)}MB)，当前最大支持 8MB`);
    }

    const fileContentBase64 = await this.readFileAsBase64(localFilePath);

    const result = await this.callApi(
      "/deploy",
      {
        fileContentBase64,
        fileName: params.fileName,
        websiteId,
      },
      accessToken
    );

    logger.success(`网站部署成功: ${result.url}`);
    return result;
  }

  /**
   * 生成 8 位由大写字母与数字组成的随机 websiteId
   */
  private generateWebsiteId(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let out = "";
    for (let i = 0; i < 8; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  private async getPathStat(
    filePath: string
  ): Promise<{ isFile: boolean; isDirectory: boolean; size: number }> {
    const fs = await import("fs");

    if (!fs.existsSync(filePath)) {
      throw new Error(`路径不存在: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    return {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
    };
  }

  private async getFileSize(filePath: string): Promise<number> {
    const stat = await this.getPathStat(filePath);
    return stat.size;
  }

  private async readFileAsBase64(filePath: string): Promise<string> {
    const fs = await import("fs");
    const buffer = fs.readFileSync(filePath);
    return buffer.toString("base64");
  }

  private async zipDirectoryToFile(dirPath: string): Promise<string> {
    const fs = await import("fs");
    const pathModule = await import("path");
    const os = await import("os");
    const AdmZip = await import("adm-zip");

    const zip = new AdmZip.default();
    zip.addLocalFolder(dirPath);

    const tempFile = pathModule.join(os.tmpdir(), `demox-deploy-${Date.now()}.zip`);
    zip.writeZip(tempFile);

    logger.debug(`目录打包成功: ${dirPath} -> ${tempFile}`);
    return tempFile;
  }

  private async downloadZipFileToBuffer(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`下载失败: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async saveBufferToTempFile(buffer: Buffer): Promise<string> {
    const fs = await import("fs");
    const pathModule = await import("path");
    const os = await import("os");

    const tempFile = pathModule.join(os.tmpdir(), `demox-download-${Date.now()}.zip`);
    fs.writeFileSync(tempFile, buffer);
    return tempFile;
  }

  /**
   * 列出所有网站
   */
  async listWebsites(accessToken: string): Promise<Website[]> {
    const result = await this.callApi("/websites", { action: "list" }, accessToken);
    return result.files || result.websites || [];
  }

  /**
   * 删除网站
   */
  async deleteWebsite(websiteId: string, accessToken: string): Promise<void> {
    await this.callApi("/delete", { websiteId }, accessToken);
    logger.success("网站已删除");
  }

  /**
   * 获取网站详情
   */
  async getWebsite(websiteId: string, accessToken: string): Promise<Website | null> {
    const websites = await this.listWebsites(accessToken);
    return websites.find((w) => w.websiteId === websiteId) || null;
  }
}
