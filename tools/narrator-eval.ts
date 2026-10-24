import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gameData } from "@cp/content";
import {
  buildNarratorPrompt,
  fixedRng,
  type LlmClient,
  type LlmUsage,
  runNarratorTurn,
  seededRng,
} from "@cp/core";
import { ConfigService, LlmRouter } from "@cp/server/llm";
import { buildScenario, type EvalCase, loadCases, type Scenario } from "./narrator-eval/case";
import { codeFindings, type Finding, moduleFindings } from "./narrator-eval/checks";
import { grade, type Score } from "./narrator-eval/grader";

/**
 * 叙事模型测评：pnpm eval [--narrator 方案] [--aux 方案] [--grader 方案] [--tag a,b] [--case id,id]
 *   [--repeat 3] [--jobs 2] [--offline]
 * 调用真实模型，会花钱；--offline 只检查用例和规则模块选择，不调模型。
 * 结果写进 tools/evals/results/，并和上一次对比
 */

const ROOT = join(import.meta.dirname, "..");
const CASES = join(import.meta.dirname, "evals");
const RESULTS = join(CASES, "results");

const { values: args } = parseArgs({
  options: {
    narrator: { type: "string" },
    aux: { type: "string" },
    grader: { type: "string" },
    tag: { type: "string" },
    case: { type: "string" },
    repeat: { type: "string", default: "3" },
    jobs: { type: "string", default: "2" },
    offline: { type: "boolean", default: false },
    config: { type: "string", default: join(ROOT, "config.json") },
  },
});

const list = (v: string | undefined) =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

function positive(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} 要是正整数：${raw}`);
  return n;
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
}
const zero = (): Usage => ({ inputTokens: 0, outputTokens: 0 });
function add(total: Usage, u: LlmUsage | undefined): void {
  if (!u) return;
  total.inputTokens += u.inputTokens;
  total.outputTokens += u.outputTokens;
}

interface RunResult {
  readonly rep: number;
  readonly ok: boolean;
  readonly findings: readonly Finding[];
  readonly scores: readonly Score[];
  readonly gradeError?: string;
  readonly text?: string;
  readonly block?: unknown;
  readonly ms: number;
}

interface CaseSummary {
  readonly title: string;
  readonly tags: readonly string[];
  readonly passed: number;
  readonly runs: number;
  /** 所有评分项、所有重复的平均分；没有评分时为 null */
  readonly score: number | null;
  readonly failures: Readonly<Record<string, number>>;
  readonly results: readonly RunResult[];
}

interface ResultFile {
  readonly at: string;
  readonly narrator: string;
  readonly aux: string;
  readonly grader: string | null;
  readonly repeat: number;
  readonly usage: Readonly<Record<"narrator" | "aux" | "repair" | "grader", Usage>>;
  readonly cases: Readonly<Record<string, CaseSummary>>;
}

async function pool<T>(items: readonly T[], jobs: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, worker));
}

async function previousResult(): Promise<ResultFile | undefined> {
  let files: string[];
  try {
    files = (await readdir(RESULTS)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return undefined;
  }
  const last = files.at(-1);
  return last ? (JSON.parse(await readFile(join(RESULTS, last), "utf8")) as ResultFile) : undefined;
}

const rate = (s: Pick<CaseSummary, "passed" | "runs">) => (s.runs === 0 ? 0 : s.passed / s.runs);

function offline(cases: readonly EvalCase[], scenarios: ReadonlyMap<string, Scenario>): number {
  let failed = 0;
  for (const c of cases) {
    const scenario = scenarios.get(c.id) as Scenario;
    const prompt = buildNarratorPrompt(scenario.world, scenario.records, scenario.plan, {
      data: gameData,
      opening: scenario.opening,
    });
    const findings = moduleFindings(c, prompt.modules);
    const bad = findings.filter((f) => !f.ok);
    if (bad.length > 0) failed += 1;
    const chars = prompt.messages.reduce((n, m) => n + m.content.length, 0);
    console.log(
      `${bad.length > 0 ? "✗" : "✓"} ${c.id.padEnd(28)} 模块 [${prompt.modules.join(",")}] 共 ${chars} 字${bad.length > 0 ? `  ${bad.map((f) => f.detail).join("；")}` : ""}`,
    );
  }
  console.log(`\n${cases.length} 条用例搭建成功，${failed} 条的规则模块不符合期望`);
  return failed > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const repeat = positive("repeat", args.repeat);
  const jobs = positive("jobs", args.jobs);
  const tags = list(args.tag);
  const ids = list(args.case);
  const all = await loadCases(CASES);
  const cases = all.filter(
    (c) =>
      (tags.length === 0 || c.tags.some((t) => tags.includes(t))) &&
      (ids.length === 0 || ids.includes(c.id)),
  );
  if (cases.length === 0) throw new Error("没有符合条件的用例");
  const missing = ids.filter((id) => !all.some((c) => c.id === id));
  if (missing.length > 0) throw new Error(`没有这些用例：${missing.join("、")}`);

  const scenarios = new Map<string, Scenario>();
  for (const c of cases) {
    try {
      scenarios.set(c.id, buildScenario(c));
    } catch (error) {
      throw new Error(
        `用例 ${c.id} 搭不起来：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (args.offline) return offline(cases, scenarios);

  const config = new ConfigService(args.config);
  const redact = await config.redactor();
  const pick = {
    ...(args.narrator ? { narrator: args.narrator } : {}),
    ...(args.aux ? { aux: args.aux } : {}),
  };
  const narratorLlm = new LlmRouter(config, pick);
  const describe = async (router: LlmRouter, purpose: "narrator" | "aux") => {
    const resolved = await router.resolve(purpose);
    if (!resolved.ok) throw new Error(redact(resolved.error));
    return `${resolved.profile.name}（${resolved.profile.model}）`;
  };
  const narratorName = await describe(narratorLlm, "narrator");
  const auxName = await describe(narratorLlm, "aux");
  let graderLlm: LlmClient | undefined;
  let graderName: string | null = null;
  if (args.grader) {
    const router = new LlmRouter(config, { narrator: args.grader });
    graderName = await describe(router, "narrator");
    graderLlm = router;
  }
  console.log(
    `叙事模型 ${narratorName}，辅助 ${auxName}，评分 ${graderName ?? "不评（没给 --grader，只跑代码检查）"}`,
  );
  console.log(`${cases.length} 条用例 × ${repeat} 次，并发 ${jobs}；调用真实模型，会产生费用\n`);

  const usage = { narrator: zero(), aux: zero(), repair: zero(), grader: zero() };
  const results = new Map<string, RunResult[]>(cases.map((c) => [c.id, []]));
  const tasks = cases.flatMap((c) => Array.from({ length: repeat }, (_, rep) => ({ c, rep })));

  await pool(tasks, jobs, async ({ c, rep }) => {
    const scenario = scenarios.get(c.id) as Scenario;
    const started = Date.now();
    const rng = c.dice ? fixedRng(c.dice) : seededRng(rep + 1);
    let run: RunResult;
    try {
      const result = await runNarratorTurn(
        { llm: narratorLlm, rng, data: gameData, opening: scenario.opening },
        scenario.world,
        scenario.records,
        scenario.plan,
      );
      if (result.kind === "blocked") {
        run = {
          rep,
          ok: false,
          findings: [{ name: "拒答", ok: false, detail: redact(result.reason) }],
          scores: [],
          ms: Date.now() - started,
        };
      } else {
        const { turn } = result;
        add(usage.narrator, turn.usage);
        add(usage.aux, turn.auxUsage);
        add(usage.repair, turn.repairUsage);
        const findings = codeFindings(c, scenario.plan, turn);
        let scores: readonly Score[] = [];
        let gradeError: string | undefined;
        if (graderLlm && c.rubric.length > 0) {
          try {
            const graded = await grade(graderLlm, c, scenario, scenario.plan, turn);
            add(usage.grader, graded.usage);
            if (graded.ok) scores = graded.scores;
            else gradeError = graded.error;
          } catch (error) {
            gradeError = redact(error instanceof Error ? error.message : String(error));
          }
        }
        run = {
          rep,
          ok: findings.every((f) => f.ok),
          findings,
          scores,
          ...(gradeError ? { gradeError } : {}),
          text: turn.text,
          block: {
            read: turn.read,
            check: turn.check ?? null,
            choices: turn.choices,
            commands: turn.commands,
            dropped: turn.dropped,
            notes: turn.notes,
            modules: turn.modules,
            repairs: turn.repairs,
          },
          ms: Date.now() - started,
        };
      }
    } catch (error) {
      run = {
        rep,
        ok: false,
        findings: [
          {
            name: "调用出错",
            ok: false,
            detail: redact(error instanceof Error ? error.message : String(error)),
          },
        ],
        scores: [],
        ms: Date.now() - started,
      };
    }
    (results.get(c.id) as RunResult[]).push(run);
    const bad = run.findings.filter((f) => !f.ok).map((f) => f.name);
    const avg =
      run.scores.length > 0
        ? (run.scores.reduce((n, s) => n + s.score, 0) / run.scores.length).toFixed(1)
        : "-";
    console.log(
      `${run.ok ? "✓" : "✗"} ${c.id} #${rep + 1}  评分 ${avg}  ${(run.ms / 1000).toFixed(1)}s${bad.length > 0 ? `  ${bad.join("、")}` : ""}`,
    );
  });

  const summaries: Record<string, CaseSummary> = {};
  for (const c of cases) {
    const runs = (results.get(c.id) as RunResult[]).sort((a, b) => a.rep - b.rep);
    const scores = runs.flatMap((r) => r.scores.map((s) => s.score));
    const failures: Record<string, number> = {};
    for (const r of runs)
      for (const f of r.findings) if (!f.ok) failures[f.name] = (failures[f.name] ?? 0) + 1;
    summaries[c.id] = {
      title: c.title,
      tags: c.tags,
      passed: runs.filter((r) => r.ok).length,
      runs: runs.length,
      score: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      failures,
      results: runs,
    };
  }

  const previous = await previousResult();
  const file: ResultFile = {
    at: new Date().toISOString(),
    narrator: narratorName,
    aux: auxName,
    grader: graderName,
    repeat,
    usage,
    cases: summaries,
  };
  await mkdir(RESULTS, { recursive: true });
  const name = `${file.at.replace(/[:.]/g, "-")}.json`;
  await writeFile(join(RESULTS, name), `${JSON.stringify(file, null, 2)}\n`);

  console.log("\n用例                          通过   评分  失败项");
  for (const [id, s] of Object.entries(summaries)) {
    const fails = Object.entries(s.failures)
      .map(([k, n]) => `${k}×${n}`)
      .join("、");
    console.log(
      `${id.padEnd(30)}${`${s.passed}/${s.runs}`.padEnd(7)}${(s.score?.toFixed(1) ?? "-").padEnd(6)}${fails}`,
    );
  }
  const total = Object.values(summaries);
  const passed = total.reduce((n, s) => n + s.passed, 0);
  const runs = total.reduce((n, s) => n + s.runs, 0);
  console.log(`\n通过 ${passed}/${runs} 次`);

  if (previous) {
    const worse: string[] = [];
    for (const [id, s] of Object.entries(summaries)) {
      const before = previous.cases[id];
      if (!before) continue;
      const reasons: string[] = [];
      if (rate(s) < rate(before))
        reasons.push(`通过 ${before.passed}/${before.runs} → ${s.passed}/${s.runs}`);
      if (s.score !== null && before.score !== null && s.score <= before.score - 0.5) {
        reasons.push(`评分 ${before.score.toFixed(1)} → ${s.score.toFixed(1)}`);
      }
      if (reasons.length > 0) worse.push(`  ${id}：${reasons.join("，")}`);
    }
    console.log(
      `和上一次（${previous.at}，${previous.narrator}）相比：${worse.length > 0 ? `${worse.length} 条变差` : "没有变差的用例"}`,
    );
    for (const line of worse) console.log(line);
  }
  const u = (x: Usage) => `输入 ${x.inputTokens}，输出 ${x.outputTokens}`;
  console.log(
    `\ntoken 用量：叙事模型 ${u(usage.narrator)}；抽取和核对 ${u(usage.aux)}；格式修复 ${u(usage.repair)}；评分 ${u(usage.grader)}`,
  );
  console.log(`结果：tools/evals/results/${name}`);
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
