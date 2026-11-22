import { type SpawnSyncOptions, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER_TOML_PATH = join(ROOT_DIR, "apps", "web", "wrangler.toml");
const DEFAULT_PAGES_URL = "https://cyberpunk-am6.pages.dev";

interface PublishOptions {
  message?: string;
  remote: string;
  project?: string;
  skipGit: boolean;
  skipPages: boolean;
  skipBuild: boolean;
  runCheck: boolean;
  help: boolean;
}

interface CommandRunner {
  command: string;
  prefixArgs: string[];
  shell: boolean;
  env?: NodeJS.ProcessEnv;
}

function printHelp(): void {
  console.log(`
赛博朋克2091 · 一键推送脚本（GitHub + Cloudflare Pages）

用法:
  pnpm push [选项]
  publish.cmd [选项]

选项:
  -m, --message <说明>   有未提交改动时，自动 git add -A 并以该说明提交
  --skip-git             跳过 Git 提交与推送，仅构建并部署 Cloudflare Pages
  --skip-pages           跳过构建与 Cloudflare Pages 部署，仅推送 GitHub
  --skip-build           跳过重新构建，直接上传现有 apps/web/dist 到 Pages
  --check                推送前先执行 pnpm typecheck
  --remote <名称>        指定 Git 远程仓库名（默认: origin）
  --project <项目名>     指定 Cloudflare Pages 项目名（默认读取 apps/web/wrangler.toml）
  -h, --help             显示此帮助信息

示例:
  pnpm push
  pnpm push -- -m "feat: 更新剧情内容"
  pnpm push -- --check
  pnpm push -- --skip-git
`);
}

function parseArgs(argv: string[]): PublishOptions {
  const options: PublishOptions = {
    remote: "origin",
    skipGit: false,
    skipPages: false,
    skipBuild: false,
    runCheck: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-m":
      case "--message": {
        const value = argv[i + 1];
        if (!value || value.startsWith("-")) {
          throw new Error(`参数 ${arg} 需要提供提交说明`);
        }
        options.message = value;
        i += 1;
        break;
      }
      case "--remote": {
        const value = argv[i + 1];
        if (!value || value.startsWith("-")) {
          throw new Error("参数 --remote 需要提供远程仓库名");
        }
        options.remote = value;
        i += 1;
        break;
      }
      case "--project": {
        const value = argv[i + 1];
        if (!value || value.startsWith("-")) {
          throw new Error("参数 --project 需要提供 Cloudflare Pages 项目名");
        }
        options.project = value;
        i += 1;
        break;
      }
      case "--skip-git":
        options.skipGit = true;
        break;
      case "--skip-pages":
        options.skipPages = true;
        break;
      case "--skip-build":
        options.skipBuild = true;
        break;
      case "--check":
        options.runCheck = true;
        break;
      case "--":
        break;
      default:
        throw new Error(`未知参数: ${arg}（使用 --help 查看用法）`);
    }
  }

  return options;
}

function logStep(index: number, total: number, title: string): void {
  console.log(`\n[${index}/${total}] ${title}`);
  console.log("─".repeat(52));
}

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    shell?: boolean;
    capture?: boolean;
    allowFailure?: boolean;
  } = {},
): { status: number; stdout: string; stderr: string } {
  const spawnOptions: SpawnSyncOptions = {
    cwd: options.cwd ?? ROOT_DIR,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    shell: options.shell ?? false,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  };

  const result = spawnSync(command, args, spawnOptions);
  if (result.error) {
    if (options.allowFailure) {
      return { status: 1, stdout: "", stderr: result.error.message };
    }
    throw new Error(`执行命令失败: ${command} ${args.join(" ")} (${result.error.message})`);
  }

  const status = result.status ?? 1;
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";

  if (status !== 0 && !options.allowFailure) {
    throw new Error(`命令执行失败（退出码 ${status}）: ${command} ${args.join(" ")}`);
  }

  return { status, stdout, stderr };
}

function git(args: string[], options: { capture?: boolean; allowFailure?: boolean } = {}) {
  return runCommand("git", args, {
    capture: options.capture ?? false,
    allowFailure: options.allowFailure ?? false,
  });
}

function detectWindowsSystemProxy(): NodeJS.ProcessEnv | undefined {
  if (process.platform !== "win32") return undefined;
  if (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy
  ) {
    return undefined;
  }

  const res = runCommand(
    "reg",
    ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"],
    { capture: true, allowFailure: true },
  );
  if (res.status !== 0) return undefined;

  const enableMatch = res.stdout.match(/ProxyEnable\s+REG_DWORD\s+0x([0-9a-fA-F]+)/i);
  if (!enableMatch?.[1] || Number.parseInt(enableMatch[1], 16) !== 1) return undefined;

  const serverMatch = res.stdout.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i);
  const rawServer = serverMatch?.[1]?.trim();
  if (!rawServer) return undefined;

  const normalize = (value: string): string =>
    /^https?:\/\//i.test(value) ? value : `http://${value}`;

  if (rawServer.includes("=")) {
    const entries = new Map<string, string>();
    for (const part of rawServer.split(";")) {
      const [key, val] = part.split("=");
      if (key && val) entries.set(key.trim().toLowerCase(), val.trim());
    }
    const httpVal = entries.get("http");
    const httpsVal = entries.get("https") ?? httpVal;
    const env: NodeJS.ProcessEnv = {};
    if (httpVal) env.HTTP_PROXY = normalize(httpVal);
    if (httpsVal) env.HTTPS_PROXY = normalize(httpsVal);
    return Object.keys(env).length > 0 ? env : undefined;
  }

  const proxyUrl = normalize(rawServer);
  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
  };
}

function readPackageManagerVersion(): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf8")) as {
      packageManager?: string;
    };
    const match = pkg.packageManager?.match(/^pnpm@([\d.]+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * 兼容 Windows 上 pnpm.CMD 在 cmd/pwsh 下指向无后缀脚本的问题：
 * 1) 优先直接调用 pnpm
 * 2) 失败时定位 %LOCALAPPDATA%\pnpm\.tools\pnpm\<version>\node_modules\pnpm\bin\pnpm.mjs 用 node 启动
 * 3) 最后兜底关闭 manage-package-manager-versions 再试一次
 */
function resolvePnpmRunner(): CommandRunner {
  const isWin = process.platform === "win32";
  const direct = runCommand(isWin ? "pnpm.cmd" : "pnpm", ["--version"], {
    shell: isWin,
    capture: true,
    allowFailure: true,
  });
  if (direct.status === 0 && direct.stdout.trim()) {
    return { command: isWin ? "pnpm.cmd" : "pnpm", prefixArgs: [], shell: isWin };
  }

  if (isWin && process.env.LOCALAPPDATA) {
    const toolsBase = join(process.env.LOCALAPPDATA, "pnpm", ".tools", "pnpm");
    const targetVersion = readPackageManagerVersion();
    const candidates: string[] = [];

    if (targetVersion) {
      candidates.push(join(toolsBase, targetVersion, "node_modules", "pnpm", "bin", "pnpm.mjs"));
    }

    if (existsSync(toolsBase)) {
      const dirs = readdirSync(toolsBase, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
      for (const dir of dirs) {
        candidates.push(join(toolsBase, dir, "node_modules", "pnpm", "bin", "pnpm.mjs"));
      }
    }

    for (const scriptPath of candidates) {
      if (existsSync(scriptPath)) {
        return {
          command: process.execPath,
          prefixArgs: [scriptPath],
          shell: false,
        };
      }
    }
  }

  const fallbackEnv: NodeJS.ProcessEnv = {
    npm_config_manage_package_manager_versions: "false",
  };
  const fallback = runCommand(isWin ? "pnpm.cmd" : "pnpm", ["--version"], {
    shell: isWin,
    env: fallbackEnv,
    capture: true,
    allowFailure: true,
  });
  if (fallback.status === 0 && fallback.stdout.trim()) {
    return {
      command: isWin ? "pnpm.cmd" : "pnpm",
      prefixArgs: [],
      shell: isWin,
      env: fallbackEnv,
    };
  }

  throw new Error("未找到可用的 pnpm，请确认已安装 pnpm 或检查 PATH 配置");
}

function runPnpm(runner: CommandRunner, args: string[], extraEnv?: NodeJS.ProcessEnv): void {
  const mergedEnv: NodeJS.ProcessEnv = {
    ...(runner.env ?? {}),
    ...(extraEnv ?? {}),
  };
  if (Object.keys(mergedEnv).length > 0) {
    runCommand(runner.command, [...runner.prefixArgs, ...args], {
      shell: runner.shell,
      env: mergedEnv,
    });
    return;
  }
  runCommand(runner.command, [...runner.prefixArgs, ...args], {
    shell: runner.shell,
  });
}

function readWranglerConfig(): { projectName: string; outputDir: string } {
  let projectName = "cyberpunk";
  let outputDir = "dist";

  if (existsSync(WRANGLER_TOML_PATH)) {
    const content = readFileSync(WRANGLER_TOML_PATH, "utf8");
    const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (nameMatch?.[1]) {
      projectName = nameMatch[1];
    }
    const dirMatch = content.match(/^\s*pages_build_output_dir\s*=\s*"([^"]+)"/m);
    if (dirMatch?.[1]) {
      outputDir = dirMatch[1];
    }
  }

  return { projectName, outputDir };
}

function getCurrentBranch(): string {
  const res = git(["rev-parse", "--abbrev-ref", "HEAD"], { capture: true });
  const branch = res.stdout.trim();
  if (!branch || branch === "HEAD") {
    throw new Error("当前处于游离 HEAD 状态，请先切换到正常分支（如 main）后再推送");
  }
  return branch;
}

async function handleDirtyWorkingTree(messageOption: string | undefined): Promise<void> {
  const status = git(["status", "--porcelain"], { capture: true }).stdout.trim();
  if (!status) {
    console.log("工作区干净，无需新建提交。");
    return;
  }

  console.log("检测到未提交的改动：\n");
  git(["status", "--short"]);
  console.log("");

  let commitMessage = messageOption?.trim();
  if (!commitMessage) {
    if (!process.stdin.isTTY) {
      throw new Error('工作区存在未提交改动，非交互模式下请使用 -m "提交说明" 或先手动提交');
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (
        await rl.question("请输入提交说明直接 commit（输入 skip 仅推送已提交内容，直接回车取消）: ")
      ).trim();

      if (!answer || answer.toLowerCase() === "q" || answer.toLowerCase() === "n") {
        throw new Error("已取消推送。");
      }
      if (answer.toLowerCase() === "skip" || answer.toLowerCase() === "s") {
        console.log("已跳过提交未暂存改动，继续推送现有提交。");
        return;
      }
      commitMessage = answer;
    } finally {
      rl.close();
    }
  }

  console.log(`正在暂存并提交：${commitMessage}`);
  git(["add", "-A"]);
  git(["commit", "-m", commitMessage]);
}

function pushToGitHub(remote: string, branch: string): { remoteUrl: string } {
  const remoteRes = git(["remote", "get-url", remote], { capture: true, allowFailure: true });
  if (remoteRes.status !== 0 || !remoteRes.stdout.trim()) {
    throw new Error(`未找到 Git 远程仓库 "${remote}"，请检查 git remote -v`);
  }

  const remoteUrl = remoteRes.stdout.trim();
  console.log(`目标仓库: ${remote} (${remoteUrl})`);
  console.log(`当前分支: ${branch}`);

  const pushRes = git(["push", "-u", remote, branch], { allowFailure: true });
  if (pushRes.status !== 0) {
    throw new Error(
      `推送到 ${remote}/${branch} 失败。若远程存在新提交，请先执行 git pull --rebase ${remote} ${branch} 后重试。`,
    );
  }

  return { remoteUrl };
}

function deployToCloudflarePages(
  pnpmRunner: CommandRunner,
  projectName: string,
  distRelPath: string,
  branch: string,
  skipBuild: boolean,
): void {
  const distAbsPath = join(ROOT_DIR, distRelPath);

  if (skipBuild) {
    console.log("已按参数跳过构建，直接检查现有产物目录。");
  } else {
    console.log("校验素材清单...");
    runPnpm(pnpmRunner, ["--filter", "@cp/tools", "run", "check-assets"]);
    console.log("开始构建前端静态产物（CP_BASE=/）...");
    runPnpm(pnpmRunner, ["--filter", "@cp/web", "exec", "vite", "build"], { CP_BASE: "/" });
  }

  if (!existsSync(join(distAbsPath, "index.html"))) {
    throw new Error(`未找到构建产物 ${join(distRelPath, "index.html")}，请先完成构建`);
  }

  console.log(
    `\n正在上传 ${distRelPath} 到 Cloudflare Pages（项目: ${projectName}，分支: ${branch}）...`,
  );
  const deployEnv: NodeJS.ProcessEnv = {
    ...(pnpmRunner.env ?? {}),
  };
  const deployRes = runCommand(
    pnpmRunner.command,
    [
      ...pnpmRunner.prefixArgs,
      "dlx",
      "wrangler",
      "pages",
      "deploy",
      distRelPath,
      "--project-name",
      projectName,
      "--branch",
      branch,
    ],
    {
      shell: pnpmRunner.shell,
      allowFailure: true,
      ...(Object.keys(deployEnv).length > 0 ? { env: deployEnv } : {}),
    },
  );

  if (deployRes.status !== 0) {
    throw new Error(
      "Cloudflare Pages 部署失败。若是首次使用或登录过期，请先执行 pnpm dlx wrangler login 后重试。",
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.skipGit && options.skipPages) {
    throw new Error("不能同时指定 --skip-git 和 --skip-pages");
  }

  const proxyEnv = detectWindowsSystemProxy();
  if (proxyEnv) {
    Object.assign(process.env, proxyEnv);
  }

  const branch = getCurrentBranch();
  const wranglerConfig = readWranglerConfig();
  const projectName = options.project ?? wranglerConfig.projectName;
  const distRelPath = join("apps", "web", wranglerConfig.outputDir);

  const needsPnpm = options.runCheck || (!options.skipPages && !options.skipBuild);
  const pnpmRunner = needsPnpm ? resolvePnpmRunner() : undefined;

  const totalSteps =
    (options.runCheck ? 1 : 0) + (options.skipGit ? 0 : 1) + (options.skipPages ? 0 : 1);
  let currentStep = 0;

  console.log("====================================================");
  console.log("  赛博朋克2091 · 一键推送 GitHub & Cloudflare Pages");
  console.log("====================================================");
  console.log(`仓库目录: ${ROOT_DIR}`);
  console.log(`当前分支: ${branch}`);
  if (proxyEnv?.HTTPS_PROXY) {
    console.log(`系统代理: ${proxyEnv.HTTPS_PROXY}（已自动继承）`);
  }

  if (options.runCheck && pnpmRunner) {
    currentStep += 1;
    logStep(currentStep, totalSteps, "静态类型检查（typecheck）");
    runPnpm(pnpmRunner, ["-r", "--parallel", "run", "typecheck"]);
  }

  let remoteUrl: string | undefined;
  if (!options.skipGit) {
    currentStep += 1;
    logStep(currentStep, totalSteps, `推送代码到 GitHub (${options.remote}/${branch})`);
    await handleDirtyWorkingTree(options.message);
    remoteUrl = pushToGitHub(options.remote, branch).remoteUrl;
  }

  if (!options.skipPages) {
    currentStep += 1;
    logStep(currentStep, totalSteps, `构建并部署到 Cloudflare Pages (${projectName})`);
    const runner = pnpmRunner ?? resolvePnpmRunner();
    deployToCloudflarePages(runner, projectName, distRelPath, branch, options.skipBuild);
  }

  console.log("\n====================================================");
  console.log("  全部推送完成！");
  if (remoteUrl) {
    console.log(`  GitHub : ${remoteUrl} [${branch}]`);
  }
  if (!options.skipPages) {
    if (branch === "main") {
      console.log(`  Pages  : ${DEFAULT_PAGES_URL} (生产环境)`);
    } else {
      console.log(`  Pages  : 已作为分支 "${branch}" 预览环境部署（详见上方 Wrangler 输出链接）`);
    }
  }
  console.log("====================================================");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[失败] ${message}`);
  process.exit(1);
});
