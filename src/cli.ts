#!/usr/bin/env node

/**
 * Demox CLI - 部署静态网站的命令行工具
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { existsSync, promises as fs } from "fs";
import pathModule from "path";
import { OAuthManager, TokenData } from "./auth/oauth.js";
import { DemoxClient, AuthError, type Website } from "./api/client.js";
import { getTokenPath, getConfigDir } from "./utils/config.js";
import { logger } from "./utils/logger.js";

const program = new Command();

program
  .name("demox")
  .description("Demox CLI - 部署静态网站到云端")
  .version("1.1.0");

function printWebsiteUrlLines(site: Website, indent = "   ") {
  console.log(chalk.blue(`${indent}URL: ${site.url}`));
  if (site.customUrl && site.defaultUrl && site.customUrl !== site.defaultUrl) {
    console.log(chalk.gray(`${indent}默认域名: ${site.defaultUrl}`));
  }
}

/**
 * 登录命令
 */
program
  .command("login")
  .description("登录到 Demox 服务")
  .action(async () => {
    const oauth = new OAuthManager();

    try {
      await oauth.authorize();
      process.exit(0);
    } catch (error: any) {
      logger.error(error.message);
      process.exit(1);
    }
  });

/**
 * 登出命令
 */
program
  .command("logout")
  .description("登出并删除本地 Token")
  .action(async () => {
    const tokenPath = getTokenPath();

    if (!existsSync(tokenPath)) {
      logger.info("未找到本地 Token");
      process.exit(0);
      return;
    }

    try {
      await fs.unlink(tokenPath);
      logger.success("已登出");
      process.exit(0);
    } catch (error: any) {
      logger.error("登出失败: " + error.message);
      process.exit(1);
    }
  });

/**
 * 状态命令
 */
program
  .command("status")
  .description("查看当前登录状态")
  .action(async () => {
    const tokenPath = getTokenPath();

    if (!existsSync(tokenPath)) {
      console.log(chalk.yellow("\n未登录"));
      console.log(chalk.gray("请运行: demox login\n"));
      process.exit(0);
      return;
    }

    try {
      const content = await fs.readFile(tokenPath, "utf-8");
      const tokenData: TokenData = JSON.parse(content);

      const now = Date.now();
      const daysLeft = Math.floor((tokenData.expiresAt - now) / (1000 * 60 * 60 * 24));

      console.log(chalk.green("\n✔ 已登录"));
      console.log(chalk.gray(`  用户 ID: ${tokenData.userId}`));
      console.log(chalk.gray(`  客户端 ID: ${tokenData.clientId}`));
      console.log(chalk.gray(`  权限范围: ${tokenData.scopes.join(", ")}`));

      if (daysLeft > 0) {
        console.log(chalk.gray(`  Token 有效期: ${daysLeft} 天`));
      } else if (daysLeft === 0) {
        console.log(chalk.yellow("  ⚠ Token 将在今天过期"));
      } else {
        console.log(chalk.yellow("  ⚠ Token 已过期，请重新登录"));
      }

      console.log(chalk.gray(`  保存位置: ${tokenPath}\n`));
      process.exit(0);
    } catch (error: any) {
      logger.error("读取状态失败: " + error.message);
      process.exit(1);
    }
  });

/**
 * 列出网站命令
 */
program
  .command("list")
  .alias("ls")
  .description("列出所有网站")
  .action(async () => {
    const spinner = ora("正在获取网站列表...").start();

    try {
      const oauth = new OAuthManager();
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();
      const websites = await client.listWebsites(accessToken);

      spinner.stop();

      if (websites.length === 0) {
        console.log(chalk.yellow("\n您还没有部署任何网站"));
        console.log(chalk.gray("运行 demox deploy <目录> 来部署您的第一个网站\n"));
        process.exit(0);
        return;
      }

      console.log(chalk.bold(`\n📋 您的网站列表 (共 ${websites.length} 个):\n`));

      websites.forEach((site, index) => {
        const createdDate = new Date(site.createdAt).toLocaleString("zh-CN");
        console.log(chalk.bold(`${index + 1}. ${site.fileName}`));
        console.log(chalk.gray(`   ID: ${site.websiteId}`));
        if (site.projectName || site.projectId) {
          console.log(chalk.gray(`   项目: ${site.projectName || site.projectId}`));
        }
        printWebsiteUrlLines(site);
        console.log(chalk.gray(`   创建时间: ${createdDate}\n`));
      });

      process.exit(0);
    } catch (error: any) {
      spinner.fail("获取失败");
      logger.error(error.message);
      process.exit(1);
    }
  });

/**
 * 项目列表命令
 */
program
  .command("projects")
  .description("列出项目")
  .action(async () => {
    const spinner = ora("正在获取项目列表...").start();

    try {
      const oauth = new OAuthManager();
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();
      const projects = await client.listProjects(accessToken);

      spinner.stop();

      if (projects.length === 0) {
        console.log(chalk.yellow("\n暂无项目\n"));
        process.exit(0);
        return;
      }

      console.log(chalk.bold(`\n📁 您的项目列表 (共 ${projects.length} 个):\n`));
      projects.forEach((project, index) => {
        console.log(chalk.bold(`${index + 1}. ${project.name}`));
        console.log(chalk.gray(`   ID: ${project.id}`));
        console.log(chalk.gray(`   Slug: ${project.slug}`));
        console.log(chalk.gray(`   站点数: ${project.websitesCount || 0}\n`));
      });

      process.exit(0);
    } catch (error: any) {
      spinner.fail("获取失败");
      logger.error(error.message);
      process.exit(1);
    }
  });

/**
 * 部署网站命令
 */
program
  .command("deploy <path>")
  .description("部署网站、目录、PDF 或文档")
  .option("-n, --name <name>", "网站名称")
  .option("-i, --id <id>", "网站 ID（更新现有网站）")
  .option("-p, --project <projectId>", "项目 ID（不传则使用 default 项目）")
  .option("-t, --template <template>", "文档模板：insight、warm、dark", "insight")
  .action(async (path: string, options) => {
    const oauth = new OAuthManager();

    try {
      // 获取认证
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();

      // 检查路径
      const stat = await fs.stat(path);
      const isDirectory = stat.isDirectory();
      const isZipFile = stat.isFile() && path.endsWith(".zip");
      const isFile = stat.isFile();

      let fileName = options.name;

      if (!fileName) {
        if (isDirectory) {
          fileName = pathModule.basename(path) || "unnamed";
        } else if (isFile) {
          const parsed = pathModule.parse(path);
          fileName = parsed.name || (isZipFile ? "website" : "document");
        } else {
          fileName = "unnamed";
        }
      }

      console.log(chalk.bold(`\n🚀 部署网站: ${fileName}\n`));

      const spinner = ora("正在上传和部署...").start();

      const result = await client.deployWebsite(
        {
          zipFile: path,
          websiteId: options.id,
          projectId: options.project,
          fileName,
          templateId: options.template,
        },
        accessToken
      );

      spinner.succeed("部署成功！");

      console.log(chalk.bold("\n📦 网站信息:"));
      console.log(chalk.gray(`  名称: ${fileName}`));
      console.log(chalk.gray(`  ID: ${result.websiteId}`));
      if (result.projectId) console.log(chalk.gray(`  项目 ID: ${result.projectId}`));
      console.log(chalk.blue(`  URL: ${result.url}`));
      if (result.customUrl && result.defaultUrl && result.customUrl !== result.defaultUrl) {
        console.log(chalk.gray(`  默认域名: ${result.defaultUrl}`));
      }
      console.log("");

      process.exit(0);
    } catch (error: any) {
      if (error instanceof AuthError) {
        logger.error("认证失败，请重新登录: demox login");
      } else {
        logger.error(error.message);
      }
      process.exit(1);
    }
  });

/**
 * 删除网站命令
 */
program
  .command("delete <websiteId>")
  .alias("rm")
  .description("删除网站")
  .option("-f, --force", "强制删除，不提示确认")
  .action(async (websiteId: string, options) => {
    const oauth = new OAuthManager();

    try {
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();

      // 获取网站信息
      const website = await client.getWebsite(websiteId, accessToken);

      if (!website) {
        logger.error(`未找到网站: ${websiteId}`);
        process.exit(1);
        return;
      }

      // 确认删除
      if (!options.force) {
        console.log(chalk.yellow(`\n即将删除网站:`));
        console.log(chalk.bold(`  名称: ${website.fileName}`));
        console.log(chalk.gray(`  ID: ${websiteId}`));
        console.log(chalk.blue(`  URL: ${website.url}\n`));

        const { default: inquirer } = await import("inquirer");
        const { confirm } = await inquirer.prompt([
          {
            type: "confirm",
            name: "confirm",
            message: "确定要删除吗？此操作不可撤销",
            default: false,
          },
        ]);

        if (!confirm) {
          console.log(chalk.gray("\n已取消删除\n"));
          process.exit(0);
          return;
        }
      }

      const spinner = ora("正在删除...").start();
      await client.deleteWebsite(websiteId, accessToken);
      spinner.succeed("网站已删除");

      process.exit(0);
    } catch (error: any) {
      logger.error(error.message);
      process.exit(1);
    }
  });

/**
 * 查看网站详情命令
 */
program
  .command("info <websiteId>")
  .description("查看网站详情")
  .action(async (websiteId: string) => {
    const oauth = new OAuthManager();

    try {
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();
      const website = await client.getWebsite(websiteId, accessToken);

      if (!website) {
        logger.error(`未找到网站: ${websiteId}`);
        process.exit(1);
        return;
      }

      const createdDate = new Date(website.createdAt).toLocaleString("zh-CN");
      const updatedDate = new Date(website.updatedAt).toLocaleString("zh-CN");

      console.log(chalk.bold("\n📄 网站详情:\n"));
      console.log(chalk.bold(`  名称: ${website.fileName}`));
      console.log(chalk.gray(`  ID: ${website.websiteId}`));
      if (website.projectName || website.projectId) {
        console.log(chalk.gray(`  项目: ${website.projectName || website.projectId}`));
      }
      console.log(chalk.blue(`  URL: ${website.url}`));
      if (website.customUrl && website.defaultUrl && website.customUrl !== website.defaultUrl) {
        console.log(chalk.gray(`  默认域名: ${website.defaultUrl}`));
      }
      console.log(chalk.gray(`  路径: ${website.path}`));
      console.log(chalk.gray(`  创建时间: ${createdDate}`));
      console.log(chalk.gray(`  更新时间: ${updatedDate}\n`));

      process.exit(0);
    } catch (error: any) {
      logger.error(error.message);
      process.exit(1);
    }
  });

/**
 * 自定义域名命令
 */
const domainCommand = program
  .command("domain")
  .description("管理官方域名子域名（5-63 位，<subdomain>.<domain>）");

domainCommand
  .command("check <subdomain>")
  .description("检查自定义子域名前缀是否可用")
  .option("-i, --id <websiteId>", "当前网站 ID（允许检查已绑定到自己的前缀）")
  .option("-d, --domain <domain>", "官方域名后缀（demox.site 或 vibeme.cn）", "demox.site")
  .action(async (subdomain: string, options: { id?: string; domain?: string }) => {
    const oauth = new OAuthManager();

    try {
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();
      const result = await client.checkSubdomain(subdomain, accessToken, options.id, options.domain);
      const host = `${subdomain}.${result.domain || options.domain || "demox.site"}`;

      if (result.available) {
        console.log(chalk.green(`\n✔ ${host} 可用\n`));
      } else {
        console.log(chalk.yellow(`\n⚠ ${host} 不可用`));
        if (result.message) console.log(chalk.gray(`  原因: ${result.message}`));
        console.log("");
      }
      process.exit(0);
    } catch (error: any) {
      logger.error(error.message);
      process.exit(1);
    }
  });

domainCommand
  .command("set <websiteId> <subdomain>")
  .description("给网站设置自定义子域名前缀")
  .option("-d, --domain <domain>", "官方域名后缀（demox.site 或 vibeme.cn）", "demox.site")
  .action(async (websiteId: string, subdomain: string, options: { domain?: string }) => {
    const oauth = new OAuthManager();
    const spinner = ora("正在设置自定义域名...").start();

    try {
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();
      const result = await client.setSubdomain(websiteId, subdomain, accessToken, options.domain);

      if (!result.success) {
        throw new Error(result.message || "设置失败");
      }

      spinner.succeed("自定义域名已设置");
      console.log(chalk.bold("\n🌐 域名信息:"));
      console.log(chalk.gray(`  网站 ID: ${websiteId}`));
      console.log(chalk.blue(`  URL: ${result.url || `https://${subdomain}.${result.subdomainDomain || result.subdomain_domain || options.domain || "demox.site"}/`}`));
      if (result.message) console.log(chalk.gray(`  提示: ${result.message}`));
      console.log("");
      process.exit(0);
    } catch (error: any) {
      spinner.fail("设置失败");
      logger.error(error.message);
      process.exit(1);
    }
  });

domainCommand
  .command("clear <websiteId>")
  .description("清除网站的自定义子域名前缀")
  .action(async (websiteId: string) => {
    const oauth = new OAuthManager();
    const spinner = ora("正在清除自定义域名...").start();

    try {
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();
      const result = await client.clearSubdomain(websiteId, accessToken);

      if (!result.success) {
        throw new Error(result.message || "清除失败");
      }

      spinner.succeed("自定义域名已清除");
      if (result.message) console.log(chalk.gray(`\n${result.message}\n`));
      process.exit(0);
    } catch (error: any) {
      spinner.fail("清除失败");
      logger.error(error.message);
      process.exit(1);
    }
  });

/**
 * 测试命令
 */
program
  .command("test")
  .description("测试服务连接")
  .action(async () => {
    console.log(chalk.bold("\n🔍 测试 Demox 服务连接...\n"));

    const oauth = new OAuthManager();

    try {
      // 1. 测试认证
      process.stdout.write("1. 测试认证... ");
      const accessToken = await oauth.ensureAuthenticated();
      console.log(chalk.green("✔ 认证成功"));

      // 2. 测试 API
      process.stdout.write("2. 测试 API 连接... ");
      const client = new DemoxClient();
      const websites = await client.listWebsites(accessToken);
      console.log(chalk.green(`✔ 连接成功 (${websites.length} 个网站)`));

      console.log(chalk.bold.green("\n✔ 所有测试通过！服务运行正常。\n"));
      process.exit(0);
    } catch (error: any) {
      console.log(chalk.red("✖ 失败"));
      console.log(chalk.red(`\n错误: ${error.message}\n`));
      process.exit(1);
    }
  });

/**
 * 清理命令
 */
program
  .command("clean")
  .description("清理本地缓存和 Token")
  .option("--all", "清理所有缓存")
  .action(async (options) => {
    const tokenPath = getTokenPath();
    const configDir = getConfigDir();
    let cleaned = false;

    if (existsSync(tokenPath)) {
      try {
        await fs.unlink(tokenPath);
        logger.success("已删除 Token");
        cleaned = true;
      } catch (error: any) {
        logger.error("删除 Token 失败: " + error.message);
      }
    }

    if (options.all && existsSync(configDir)) {
      try {
        await fs.rm(configDir, { recursive: true });
        logger.success("已清理所有缓存");
        cleaned = true;
      } catch (error: any) {
        logger.error("清理缓存失败: " + error.message);
      }
    }

    if (!cleaned) {
      logger.info("没有需要清理的内容");
    }

    process.exit(0);
  });

// 解析命令行参数
program.parse();

// 如果没有参数，显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
