#!/usr/bin/env node

/**
 * Demox CLI - 部署静态网站与云函数的命令行工具
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { existsSync, promises as fs } from "fs";
import { createRequire } from "module";
import pathModule from "path";
import { OAuthManager, TokenData } from "./auth/oauth.js";
import { DemoxClient, AuthError, type Website } from "./api/client.js";
import {
  parseEnvAssignments,
  readEnvFile,
  resolveFunctionSource,
} from "./api/functions.js";
import { getTokenPath, getConfigDir } from "./utils/config.js";
import { logger } from "./utils/logger.js";
import { updateCli } from "./utils/updater.js";

const program = new Command();
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

program
  .name("demox")
  .description("Demox CLI - 部署静态网站与云函数到云端")
  .version(version);

program
  .command("update")
  .description("检查并更新 Demox CLI")
  .option("--check", "仅检查是否有新版本")
  .option("--force", "即使已是最新版本也重新安装")
  .action(async (options: { check?: boolean; force?: boolean }) => {
    const spinner = ora("正在检查 Demox CLI 更新...").start();
    try {
      const result = await updateCli({
        currentVersion: version,
        checkOnly: !!options.check,
        force: !!options.force
      });
      spinner.stop();
      console.log(chalk.gray(`当前版本: ${result.currentVersion}`));
      console.log(chalk.gray(`最新版本: ${result.latestVersion}`));
      if (result.updated) {
        logger.success(`更新完成，请运行 demox --version 确认版本`);
      } else if (result.updateAvailable) {
        logger.info("发现新版本，运行 demox update 完成更新");
      } else if (result.currentAhead) {
        logger.info("当前版本高于 npm latest，无需更新");
      } else {
        logger.success("当前已是最新版本");
      }
      process.exit(0);
    } catch (error: any) {
      spinner.fail("更新失败");
      logger.error(error.message);
      process.exit(1);
    }
  });

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
 * 项目命令
 */
const projectsCmd = program.command("projects").description("管理项目");

projectsCmd
  .command("list")
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

projectsCmd
  .command("create")
  .description("创建项目（普通用户默认最多 3 个）")
  .requiredOption("-n, --name <name>", "项目名称")
  .option("--slug <slug>", "项目 slug")
  .option("--description <text>", "项目描述")
  .action(async (options: { name: string; slug?: string; description?: string }) => {
    const spinner = ora("正在创建项目...").start();
    try {
      const oauth = new OAuthManager();
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();
      const result = await client.createProject(
        { name: options.name, slug: options.slug, description: options.description },
        accessToken
      );
      spinner.stop();
      console.log(chalk.bold("\n📁 项目已创建\n"));
      console.log(chalk.gray(`  ID: ${result.project?.id}`));
      console.log(chalk.gray(`  名称: ${result.project?.name}`));
      console.log(chalk.gray(`  Slug: ${result.project?.slug}\n`));
      process.exit(0);
    } catch (error: any) {
      spinner.fail("创建失败");
      logger.error(error.message);
      process.exit(1);
    }
  });

// 兼容旧用法：demox projects → 列表
projectsCmd.action(async () => {
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
 * 项目数据库命令
 */
const dbCmd = program.command("db").description("管理项目数据库（表与行，按项目隔离，默认每项目 100MB）");

async function withDbClient<T>(
  run: (client: DemoxClient, token: string) => Promise<T>
): Promise<T> {
  const oauth = new OAuthManager();
  const accessToken = await oauth.ensureAuthenticated();
  const client = new DemoxClient();
  return run(client, accessToken);
}

dbCmd
  .command("tables")
  .description("列出项目下的表")
  .requiredOption("-p, --project <projectId>", "项目 ID")
  .action(async (options: { project: string }) => {
    const spinner = ora("正在获取表列表...").start();
    try {
      const result = await withDbClient((client, token) =>
        client.listProjectTables(options.project, token)
      );
      spinner.stop();
      const tables = result.tables || [];
      const usage = result.usage;
      if (usage) {
        const used = usage.bytesUsed ?? 0;
        const limit = usage.bytesLimit;
        console.log(
          chalk.gray(
            `\n用量: ${used} / ${limit == null ? "不限" : limit} bytes\n`
          )
        );
      }
      if (tables.length === 0) {
        console.log(chalk.yellow("暂无数据表\n"));
        process.exit(0);
        return;
      }
      tables.forEach((table: any, index: number) => {
        console.log(chalk.bold(`${index + 1}. ${table.name}`));
        console.log(chalk.gray(`   行数: ${table.rowCount ?? 0}`));
        console.log(
          chalk.gray(
            `   列: ${(table.columns || [])
              .map((c: any) => `${c.name}:${c.type}${c.primary ? "*" : ""}`)
              .join(", ")}\n`
          )
        );
      });
      process.exit(0);
    } catch (error: any) {
      spinner.fail("获取失败");
      logger.error(error.message);
      process.exit(1);
    }
  });

dbCmd
  .command("usage")
  .description("查看项目数据库用量")
  .requiredOption("-p, --project <projectId>", "项目 ID")
  .action(async (options: { project: string }) => {
    try {
      const result = await withDbClient((client, token) =>
        client.getProjectDbUsage(options.project, token)
      );
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    } catch (error: any) {
      logger.error(error.message);
      process.exit(1);
    }
  });

dbCmd
  .command("create-table")
  .description("创建表（需一个 text 主键列）")
  .requiredOption("-p, --project <projectId>", "项目 ID")
  .requiredOption("-n, --name <name>", "表名（小写字母开头）")
  .requiredOption(
    "-c, --columns <json>",
    '列定义 JSON，例如 \'[{"name":"id","type":"text","primary":true},{"name":"title","type":"text"}]\''
  )
  .action(async (options: { project: string; name: string; columns: string }) => {
    const spinner = ora("正在建表...").start();
    try {
      let columns: any;
      try {
        columns = JSON.parse(options.columns);
      } catch {
        throw new Error("--columns 需要是合法 JSON 数组");
      }
      const result = await withDbClient((client, token) =>
        client.createProjectTable(options.project, options.name, columns, token)
      );
      spinner.succeed("表已创建");
      console.log(JSON.stringify(result.table || result, null, 2));
      process.exit(0);
    } catch (error: any) {
      spinner.fail("建表失败");
      logger.error(error.message);
      process.exit(1);
    }
  });

dbCmd
  .command("describe")
  .description("查看表结构")
  .requiredOption("-p, --project <projectId>", "项目 ID")
  .requiredOption("-t, --table <name>", "表名")
  .action(async (options: { project: string; table: string }) => {
    try {
      const result = await withDbClient((client, token) =>
        client.getProjectTable(options.project, options.table, token)
      );
      console.log(JSON.stringify(result.table || result, null, 2));
      process.exit(0);
    } catch (error: any) {
      logger.error(error.message);
      process.exit(1);
    }
  });

dbCmd
  .command("drop-table")
  .description("删除表及其全部行")
  .requiredOption("-p, --project <projectId>", "项目 ID")
  .requiredOption("-t, --table <name>", "表名")
  .option("-f, --force", "跳过确认")
  .action(async (options: { project: string; table: string; force?: boolean }) => {
    if (!options.force) {
      logger.error("删除表不可撤销，请加 --force 确认");
      process.exit(1);
      return;
    }
    const spinner = ora("正在删表...").start();
    try {
      const result = await withDbClient((client, token) =>
        client.deleteProjectTable(options.project, options.table, token)
      );
      spinner.succeed(`已删除表 ${result.deleted || options.table}`);
      process.exit(0);
    } catch (error: any) {
      spinner.fail("删表失败");
      logger.error(error.message);
      process.exit(1);
    }
  });

dbCmd
  .command("rows")
  .description("列出表中的行")
  .requiredOption("-p, --project <projectId>", "项目 ID")
  .requiredOption("-t, --table <name>", "表名")
  .option("--limit <n>", "每页行数", "50")
  .option("--after <pk>", "游标（上一页最后一行的主键）")
  .action(async (options: { project: string; table: string; limit?: string; after?: string }) => {
    try {
      const result = await withDbClient((client, token) =>
        client.listProjectRows(options.project, options.table, token, {
          limit: options.limit ? Number(options.limit) : undefined,
          after: options.after,
        })
      );
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    } catch (error: any) {
      logger.error(error.message);
      process.exit(1);
    }
  });

dbCmd
  .command("put")
  .description("写入或覆盖一行（按主键 upsert）")
  .requiredOption("-p, --project <projectId>", "项目 ID")
  .requiredOption("-t, --table <name>", "表名")
  .requiredOption("-v, --values <json>", "行内容 JSON")
  .action(async (options: { project: string; table: string; values: string }) => {
    const spinner = ora("正在写入...").start();
    try {
      let values: Record<string, unknown>;
      try {
        values = JSON.parse(options.values);
      } catch {
        throw new Error("--values 需要是合法 JSON 对象");
      }
      const result = await withDbClient((client, token) =>
        client.putProjectRow(options.project, options.table, values, token)
      );
      spinner.succeed(result.created ? "已插入" : "已更新");
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    } catch (error: any) {
      spinner.fail("写入失败");
      logger.error(error.message);
      process.exit(1);
    }
  });

dbCmd
  .command("delete-row")
  .description("按主键删除一行")
  .requiredOption("-p, --project <projectId>", "项目 ID")
  .requiredOption("-t, --table <name>", "表名")
  .requiredOption("--pk <pk>", "主键值")
  .option("-f, --force", "跳过确认")
  .action(async (options: { project: string; table: string; pk: string; force?: boolean }) => {
    if (!options.force) {
      logger.error("删除行不可撤销，请加 --force 确认");
      process.exit(1);
      return;
    }
    try {
      const result = await withDbClient((client, token) =>
        client.deleteProjectRow(options.project, options.table, options.pk, token)
      );
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    } catch (error: any) {
      logger.error(error.message);
      process.exit(1);
    }
  });

/**
 * 云函数命令
 */
const functionsCommand = program
  .command("functions")
  .alias("fn")
  .description("管理站点云函数");

functionsCommand
  .command("list")
  .description("列出站点云函数")
  .requiredOption("-i, --id <websiteId>", "网站 ID")
  .action(async (options: { id: string }) => {
    const spinner = ora("正在获取云函数列表...").start();
    try {
      const oauth = new OAuthManager();
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();
      const functions = await client.listFunctions(options.id, accessToken);
      spinner.stop();
      if (!functions.length) {
        console.log(chalk.yellow("\n该站点还没有云函数"));
        console.log(
          chalk.gray(
            "运行 demox functions push <文件或目录> --id <网站ID> --slug <标识>\n"
          )
        );
        process.exit(0);
        return;
      }
      console.log(chalk.bold(`\n☁ 云函数 (共 ${functions.length} 个):\n`));
      functions.forEach((item, index) => {
        console.log(chalk.bold(`${index + 1}. ${item.name || item.slug}`));
        console.log(chalk.gray(`   ID: ${item.functionId}`));
        console.log(chalk.gray(`   Slug: ${item.slug}`));
        console.log(chalk.gray(`   版本: ${item.publishedVersion || "未发布"}`));
        if (item.aliases?.length) {
          console.log(
            chalk.gray(
              `   别名: ${item.aliases
                .map((alias) => `${alias.alias}->v${alias.version}`)
                .join(", ")}`
            )
          );
        }
        if (item.invokeUrl) console.log(chalk.blue(`   URL: ${item.invokeUrl}`));
        console.log("");
      });
      process.exit(0);
    } catch (error: any) {
      spinner.fail("获取失败");
      if (error instanceof AuthError) logger.error("认证失败，请重新登录: demox login");
      else logger.error(error.message);
      process.exit(1);
    }
  });

functionsCommand
  .command("push <path>")
  .description("把本地函数代码上传为新版本（不会改别名）")
  .requiredOption("-i, --id <websiteId>", "网站 ID")
  .requiredOption("-s, --slug <slug>", "函数标识，例如 auth、website、hello")
  .option("-n, --name <name>", "函数显示名，仅新建时使用")
  .option("--entrypoint <file>", "入口文件名，默认 index.js / index.cjs / index.mjs")
  .option("--routes <routes>", "自定义路径，逗号分隔，仅新建时使用")
  .action(
    async (
      inputPath: string,
      options: {
        id: string;
        slug: string;
        name?: string;
        entrypoint?: string;
        routes?: string;
      }
    ) => {
      const oauth = new OAuthManager();
      try {
        const accessToken = await oauth.ensureAuthenticated();
        const client = new DemoxClient();
        const source = await resolveFunctionSource(inputPath, options.entrypoint);
        const routes = (options.routes || "")
          .split(/[\s,]+/)
          .map((item) => item.trim())
          .filter(Boolean);
        console.log(chalk.bold(`\n☁ 推送云函数: ${options.slug}\n`));
        const spinner = ora("正在上传函数代码...").start();
        const result = await client.pushFunction(
          {
            websiteId: options.id,
            slug: options.slug,
            name: options.name || options.slug,
            source: source.source,
            entrypoint: source.entrypoint,
            routes: routes.length ? routes : undefined,
          },
          accessToken
        );
        spinner.succeed(
          result.created
            ? "已创建 v1，production/develop 指向 v1"
            : `已上传 v${result.version}，别名未改动`
        );
        console.log(chalk.gray(`  函数 ID: ${result.functionId}`));
        console.log(chalk.gray(`  Slug: ${result.slug}`));
        console.log(chalk.gray(`  版本: ${result.version}`));
        console.log(chalk.gray(`  入口: ${result.entrypoint}`));
        if (result.aliases?.length) {
          console.log(
            chalk.gray(
              `  别名: ${result.aliases
                .map((item) => `${item.alias}->v${item.version}`)
                .join(", ")}`
            )
          );
        }
        if (result.invokeUrl) console.log(chalk.blue(`  URL: ${result.invokeUrl}`));
        console.log(
          chalk.gray(
            "  要用新版本，请执行 demox functions alias set --id <网站ID> --slug <标识> production --version=N"
          )
        );
        console.log("");
        process.exit(0);
      } catch (error: any) {
        if (error instanceof AuthError) logger.error("认证失败，请重新登录: demox login");
        else logger.error(error.message);
        process.exit(1);
      }
    }
  );

functionsCommand
  .command("invoke")
  .description("调用已发布的站点云函数")
  .requiredOption("-i, --id <websiteId>", "网站 ID")
  .requiredOption("-s, --slug <slug>", "函数标识")
  .option("-a, --alias <alias>", "别名，默认 production", "production")
  .option("-m, --method <method>", "HTTP 方法", "POST")
  .option("-b, --body <json>", "JSON 请求体，默认 {}")
  .action(
    async (options: {
      id: string;
      slug: string;
      alias?: string;
      method?: string;
      body?: string;
    }) => {
      try {
        const oauth = new OAuthManager();
        const accessToken = await oauth.ensureAuthenticated();
        const client = new DemoxClient();
        let body: unknown = {};
        if (options.body) {
          try {
            body = JSON.parse(options.body);
          } catch {
            throw new Error("请求体必须是 JSON");
          }
        }
        const result = await client.invokeSiteFunction({
          websiteId: options.id,
          slug: options.slug,
          method: options.method,
          body,
          envName: options.alias || "production",
          accessToken,
        });
        console.log(chalk.gray(`HTTP ${result.status}`));
        console.log(
          typeof result.body === "string"
            ? result.body
            : JSON.stringify(result.body, null, 2)
        );
        process.exit(result.status >= 200 && result.status < 300 ? 0 : 1);
      } catch (error: any) {
        if (error instanceof AuthError) logger.error("认证失败，请重新登录: demox login");
        else logger.error(error.message);
        process.exit(1);
      }
    }
  );

async function resolveSiteFunction(
  client: DemoxClient,
  websiteId: string,
  slug: string,
  accessToken: string
) {
  const functions = await client.listFunctions(websiteId, accessToken);
  const record = functions.find(
    (item) => item.slug === slug || item.functionId === slug
  );
  if (!record) {
    throw new Error(
      `未找到函数: ${slug}。请先执行 demox functions push <路径> --id ${websiteId} --slug ${slug}`
    );
  }
  return record;
}

async function printFunctionAliases(
  client: DemoxClient,
  websiteId: string,
  slug: string,
  accessToken: string
) {
  const record = await resolveSiteFunction(client, websiteId, slug, accessToken);
  const aliases = await client.listAliases(record.functionId, accessToken);
  if (!aliases.length) {
    console.log(chalk.yellow("还没有别名"));
    return;
  }
  console.log(chalk.bold(`\n别名 (${record.slug}):\n`));
  for (const item of aliases) console.log(`  ${item.alias} -> v${item.version}`);
  console.log("");
}

async function setFunctionAlias(
  client: DemoxClient,
  websiteId: string,
  slug: string,
  alias: string,
  version: string,
  accessToken: string
) {
  if (!version) throw new Error("修改别名时必须提供 --version");
  const record = await resolveSiteFunction(client, websiteId, slug, accessToken);
  const saved = await client.setAlias(
    record.functionId,
    alias,
    Number(version),
    accessToken
  );
  logger.success(`${saved.alias} -> v${saved.version}`);
}

const aliasCommand = functionsCommand
  .command("alias")
  .description("查看或修改函数别名");

aliasCommand
  .command("list", { isDefault: true })
  .description("列出函数别名")
  .requiredOption("-i, --id <websiteId>", "网站 ID")
  .requiredOption("-s, --slug <slug>", "函数标识")
  .option("--set <alias>", "兼容旧写法：要修改的别名，例如 production")
  .option("--version <version>", "别名指向的版本")
  .action(
    async (options: {
      id: string;
      slug: string;
      set?: string;
      version?: string;
    }) => {
      try {
        const oauth = new OAuthManager();
        const accessToken = await oauth.ensureAuthenticated();
        const client = new DemoxClient();
        if (options.set) {
          await setFunctionAlias(
            client,
            options.id,
            options.slug,
            options.set,
            String(options.version || ""),
            accessToken
          );
          process.exit(0);
          return;
        }
        await printFunctionAliases(client, options.id, options.slug, accessToken);
        process.exit(0);
      } catch (error: any) {
        if (error instanceof AuthError) logger.error("认证失败，请重新登录: demox login");
        else logger.error(error.message);
        process.exit(1);
      }
    }
  );

aliasCommand
  .command("set <alias>")
  .description("把别名指向指定版本，例如 production -> v2")
  .requiredOption("-i, --id <websiteId>", "网站 ID")
  .requiredOption("-s, --slug <slug>", "函数标识")
  .requiredOption("--version <version>", "别名指向的版本")
  .action(
    async (
      alias: string,
      options: { id: string; slug: string; version: string }
    ) => {
      try {
        const oauth = new OAuthManager();
        const accessToken = await oauth.ensureAuthenticated();
        const client = new DemoxClient();
        await setFunctionAlias(
          client,
          options.id,
          options.slug,
          alias,
          options.version,
          accessToken
        );
        process.exit(0);
      } catch (error: any) {
        if (error instanceof AuthError) logger.error("认证失败，请重新登录: demox login");
        else logger.error(error.message);
        process.exit(1);
      }
    }
  );

aliasCommand
  .command("delete <alias>")
  .description("删除自定义别名（不能删除 production / develop）")
  .requiredOption("-i, --id <websiteId>", "网站 ID")
  .requiredOption("-s, --slug <slug>", "函数标识")
  .action(async (alias: string, options: { id: string; slug: string }) => {
    try {
      const oauth = new OAuthManager();
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();
      const record = await resolveSiteFunction(
        client,
        options.id,
        options.slug,
        accessToken
      );
      await client.deleteAlias(record.functionId, alias, accessToken);
      logger.success(`已删除别名 ${alias}`);
      process.exit(0);
    } catch (error: any) {
      if (error instanceof AuthError) logger.error("认证失败，请重新登录: demox login");
      else logger.error(error.message);
      process.exit(1);
    }
  });

const envCommand = program
  .command("env")
  .description("管理函数环境变量（每个函数各自一份）");

envCommand
  .command("list")
  .description("列出函数环境变量")
  .requiredOption("-i, --id <websiteId>", "网站 ID")
  .requiredOption("-s, --slug <slug>", "函数标识")
  .option("--keys-only", "只显示变量名")
  .action(async (options: { id: string; slug: string; keysOnly?: boolean }) => {
    const spinner = ora("正在获取环境变量...").start();
    try {
      const oauth = new OAuthManager();
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();
      const record = await resolveSiteFunction(
        client,
        options.id,
        options.slug,
        accessToken
      );
      const env = await client.getFunctionEnv(record.functionId, accessToken);
      spinner.stop();
      const keys = Object.keys(env).sort();
      if (!keys.length) {
        console.log(chalk.yellow("\n该函数还没有环境变量"));
        console.log(
          chalk.gray("运行 demox env set --id <网站ID> --slug <标识> KEY=value\n")
        );
        process.exit(0);
        return;
      }
      console.log(chalk.bold(`\n🔐 环境变量 (共 ${keys.length} 个):\n`));
      for (const key of keys) {
        console.log(options.keysOnly ? key : `${key}=${env[key]}`);
      }
      console.log("");
      process.exit(0);
    } catch (error: any) {
      spinner.fail("获取失败");
      if (error instanceof AuthError) logger.error("认证失败，请重新登录: demox login");
      else logger.error(error.message);
      process.exit(1);
    }
  });

envCommand
  .command("set")
  .description("设置函数环境变量（与已有变量合并）")
  .requiredOption("-i, --id <websiteId>", "网站 ID")
  .requiredOption("-s, --slug <slug>", "函数标识")
  .option("--from <file>", "从 .env 文件读取")
  .argument("[pairs...]", "KEY=value")
  .action(
    async (
      pairs: string[],
      options: { id: string; slug: string; from?: string }
    ) => {
      try {
        const patch = {
          ...(options.from ? await readEnvFile(options.from) : {}),
          ...parseEnvAssignments(pairs || []),
        };
        if (!Object.keys(patch).length) {
          logger.error("请提供 KEY=value，或使用 --from .env");
          process.exit(1);
          return;
        }
        const oauth = new OAuthManager();
        const accessToken = await oauth.ensureAuthenticated();
        const client = new DemoxClient();
        const record = await resolveSiteFunction(
          client,
          options.id,
          options.slug,
          accessToken
        );
        const current = await client.getFunctionEnv(record.functionId, accessToken);
        const saved = await client.putFunctionEnv(
          record.functionId,
          { ...current, ...patch },
          accessToken
        );
        logger.success(
          `已更新 ${Object.keys(patch).length} 个环境变量，当前共 ${Object.keys(saved).length} 个`
        );
        process.exit(0);
      } catch (error: any) {
        if (error instanceof AuthError) logger.error("认证失败，请重新登录: demox login");
        else logger.error(error.message);
        process.exit(1);
      }
    }
  );

envCommand
  .command("unset")
  .description("删除函数环境变量")
  .requiredOption("-i, --id <websiteId>", "网站 ID")
  .requiredOption("-s, --slug <slug>", "函数标识")
  .argument("<keys...>", "要删除的变量名")
  .action(async (keys: string[], options: { id: string; slug: string }) => {
    try {
      const oauth = new OAuthManager();
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();
      const record = await resolveSiteFunction(
        client,
        options.id,
        options.slug,
        accessToken
      );
      const current = await client.getFunctionEnv(record.functionId, accessToken);
      const next = { ...current };
      for (const key of keys) delete next[key];
      await client.putFunctionEnv(record.functionId, next, accessToken);
      logger.success(`已删除 ${keys.join(", ")}`);
      process.exit(0);
    } catch (error: any) {
      if (error instanceof AuthError) logger.error("认证失败，请重新登录: demox login");
      else logger.error(error.message);
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
      console.log(chalk.gray(`  页面水印: ${website.hideWatermark ? "隐藏" : "显示"}`));
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
  .description("管理自定义子域名（5-63 位，<subdomain>.demox.site）");

domainCommand
  .command("check <subdomain>")
  .description("检查自定义子域名前缀是否可用")
  .option("-i, --id <websiteId>", "当前网站 ID（允许检查已绑定到自己的前缀）")
  .action(async (subdomain: string, options: { id?: string }) => {
    const oauth = new OAuthManager();

    try {
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();
      const result = await client.checkSubdomain(subdomain, accessToken, options.id);
      const host = `${subdomain}.demox.site`;

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
  .action(async (websiteId: string, subdomain: string) => {
    const oauth = new OAuthManager();
    const spinner = ora("正在设置自定义域名...").start();

    try {
      const accessToken = await oauth.ensureAuthenticated();
      const client = new DemoxClient();
      const result = await client.setSubdomain(websiteId, subdomain, accessToken);

      if (!result.success) {
        throw new Error(result.message || "设置失败");
      }

      spinner.succeed("自定义域名已设置");
      console.log(chalk.bold("\n🌐 域名信息:"));
      console.log(chalk.gray(`  网站 ID: ${websiteId}`));
      console.log(chalk.blue(`  URL: ${result.url || `https://${subdomain}.demox.site/`}`));
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
 * 页面水印命令。能力边界由 website-api 按账号 pro/admin 角色执行。
 */
const watermarkCommand = program
  .command("watermark")
  .description("配置站点页面水印（仅 pro/admin 角色）");

async function configureWatermark(websiteId: string, hideWatermark: boolean) {
  const oauth = new OAuthManager();
  const spinner = ora(hideWatermark ? "正在隐藏页面水印..." : "正在显示页面水印...").start();

  try {
    const accessToken = await oauth.ensureAuthenticated();
    const client = new DemoxClient();
    const result = await client.setWatermark(websiteId, hideWatermark, accessToken);

    spinner.succeed(hideWatermark ? "页面水印已隐藏" : "页面水印已显示");
    console.log(chalk.gray(`\n网站 ID: ${websiteId}`));
    if (result.message) console.log(chalk.gray(`提示: ${result.message}`));
    console.log("");
    process.exit(0);
  } catch (error: any) {
    spinner.fail("水印配置失败");
    logger.error(error.message);
    process.exit(1);
  }
}

watermarkCommand
  .command("hide <websiteId>")
  .description("隐藏站点页面中的 Powered by Demox 水印")
  .action(async (websiteId: string) => configureWatermark(websiteId, true));

watermarkCommand
  .command("show <websiteId>")
  .description("重新显示站点页面中的 Powered by Demox 水印")
  .action(async (websiteId: string) => configureWatermark(websiteId, false));

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
