// 求职雷达:托管外部 CDP 抓取脚本(scripts/boss_cdp_raw.py),按 job_id 去重入库。
// 守门(内置,不可关):单次 ≤10 页、页间随机 12-22s 延迟由脚本保证;仅限个人求职研究。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { jobs, jobsRuns } from "@/lib/db/schema";
import { readSettingsKv } from "@/lib/db/read-settings";
import { recordIssue } from "@/lib/domain/issue-store";

export const MAX_PAGES = 10;
export const OUTPUT_LIMIT = 64 * 1024;

export type JobInput = {
  jobId: string; title: string; salaryDesc?: string; city?: string; area?: string;
  brand?: string; scale?: string; experience?: string; degree?: string;
  labels?: string[]; jd?: string; url?: string; securityId?: string | null; lid?: string | null;
};

/** 解析脚本 stdout 末尾的 RESULT JSON 行(脚本约定:最后一行以 RESULT: 开头) */
export function parseScriptResult(stdout: string): { jobs: JobInput[]; searchMeta?: Record<string, unknown> } | null {
  const lines = stdout.split(/\r?\n/).reverse();
  for (const line of lines) {
    if (line.startsWith("RESULT:")) {
      try {
        const parsed = JSON.parse(line.slice(7)) as { jobs?: JobInput[]; search_meta?: Record<string, unknown> };
        return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [], searchMeta: parsed.search_meta };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** zod 免了:手工守卫字段,坏行丢弃;jobId 缺失的行不入库 */
export function sanitizeJob(raw: JobInput): JobInput | null {
  if (!raw || typeof raw.jobId !== "string" || !raw.jobId || typeof raw.title !== "string" || !raw.title) return null;
  return {
    jobId: raw.jobId,
    title: raw.title,
    salaryDesc: raw.salaryDesc ?? "",
    city: raw.city ?? "",
    area: raw.area ?? "",
    brand: raw.brand ?? "",
    scale: raw.scale ?? "",
    experience: raw.experience ?? "",
    degree: raw.degree ?? "",
    labels: Array.isArray(raw.labels) ? raw.labels.filter((l): l is string => typeof l === "string").slice(0, 10) : [],
    jd: (raw.jd ?? "").slice(0, 20_000),
    url: raw.url ?? "",
    securityId: raw.securityId ?? null,
    lid: raw.lid ?? null,
  };
}

/** 按 jobId 去重入库:存在则更新,返回 {inserted, updated} */
export function upsertJobs(db: Db, inputs: JobInput[], searchMeta: Record<string, unknown> = {}): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;
  const metaJson = JSON.stringify(searchMeta);
  const existingRows = db.select().from(jobs).all() as (typeof jobs.$inferSelect)[];
  const byJobId = new Map(existingRows.map((r) => [r.jobId, r]));
  for (const raw of inputs) {
    const j = sanitizeJob(raw);
    if (!j) continue;
    const hit = byJobId.get(j.jobId);
    const nowIso = new Date().toISOString();
    if (hit) {
      db.update(jobs).set({
        title: j.title, salaryDesc: j.salaryDesc, city: j.city, area: j.area, brand: j.brand,
        scale: j.scale, experience: j.experience, degree: j.degree, labels: JSON.stringify(j.labels),
        jd: j.jd, url: j.url, securityId: j.securityId, lid: j.lid, searchMeta: metaJson, fetchedAt: nowIso,
      }).where(eq(jobs.id, hit.id)).run();
      updated++;
    } else {
      db.insert(jobs).values({
        id: crypto.randomUUID(), jobId: j.jobId, title: j.title, salaryDesc: j.salaryDesc,
        city: j.city, area: j.area, brand: j.brand, scale: j.scale, experience: j.experience,
        degree: j.degree, labels: JSON.stringify(j.labels), jd: j.jd, url: j.url,
        securityId: j.securityId, lid: j.lid, searchMeta: metaJson, fetchedAt: nowIso,
      }).run();
      byJobId.set(j.jobId, { id: crypto.randomUUID() } as typeof jobs.$inferSelect);
      inserted++;
    }
  }
  return { inserted, updated };
}

// —— 进程托管:同时只允许一个运行中的抓取/环境操作;服务重启后残留 running 标记由 sweepStaleRuns 收敛 ——

type Running = { child: ReturnType<typeof spawn>; runId: string; kind: string; output: string; startedAt: number };
const global_ = globalThis as { __evodeskJobsRun?: Running | null };

export function currentRun(): Running | null {
  return global_.__evodeskJobsRun ?? null;
}

/** 清扫僵尸 running:进程已退出却未落库,或超过 30 分钟 → 标记 failed */
export function sweepStaleRuns(db: Db): void {
  const run = currentRun();
  if (run && run.child.exitCode !== null && run.child.pid) {
    finishRun(db, run, "failed", "进程退出但未回传结果");
  }
  const rows = db.select().from(jobsRuns).all() as (typeof jobsRuns.$inferSelect)[];
  for (const r of rows) {
    if (r.status === "running" && Date.now() - new Date(r.startedAt).getTime() > 30 * 60_000) {
      db.update(jobsRuns).set({ status: "failed", output: "超时清扫:运行超过 30 分钟", finishedAt: new Date().toISOString() }).where(eq(jobsRuns.id, r.id)).run();
      if (run && run.runId === r.id) global_.__evodeskJobsRun = null;
    }
  }
}

function finishRun(db: Db, run: Running, status: string, note: string, jobCount = 0): void {
  const output = `${run.output.slice(-OUTPUT_LIMIT)}\n${note}`.trim();
  db.update(jobsRuns).set({
    status, jobCount,
    output,
    finishedAt: new Date().toISOString(),
  }).where(eq(jobsRuns.id, run.runId)).run();
  global_.__evodeskJobsRun = null;
  // 自愈:失败自动入账(启发式诊断,见 issue-store);忽略不影响原流程
  if (status === "failed") {
    try {
      recordIssue(db, { source: "job", sourceId: run.runId, sourceLabel: `BOSS ${kindLabel(run.kind)}`, errorText: output });
    } catch { /* 记录失败不掩盖原错误 */ }
  }
}

function kindLabel(kind: string): string {
  return kind === "setup" ? "启动 Chrome" : kind === "check" ? "环境检查" : kind === "smoke" ? "连通自检" : "抓取";
}

export type SpawnOptions = {
  kind: "scrape" | "check" | "setup" | "smoke";
  args: string[];
  db: Db;
  params?: Record<string, unknown>;
  /** 测试注入用:覆盖默认脚本路径 */
  scriptPath?: string;
};

/** 启动脚本进程,stdout 增量累积;结束时按 RESULT: 行入库(仅 scrape) */
export async function spawnJobsScript({ kind, args, db, params = {}, scriptPath: scriptOverride }: SpawnOptions): Promise<{ runId: string } | { error: string }> {
  sweepStaleRuns(db);
  if (currentRun()) return { error: "已有任务在运行,请等待完成或查看运行记录" };
  const scriptPath = scriptOverride ?? path.join(process.cwd(), "scripts", "boss_cdp_raw.py");
  if (!fs.existsSync(scriptPath)) return { error: "缺少 scripts/boss_cdp_raw.py" };
  const kv = await readSettingsKv(db);
  const pythonCmd = typeof kv.boss_python_cmd === "string" && kv.boss_python_cmd.trim() ? kv.boss_python_cmd.trim() : "python";

  const nowIso = new Date().toISOString();
  const runId = crypto.randomUUID();
  db.insert(jobsRuns).values({ id: runId, kind, params: JSON.stringify(params), status: "running", output: "", jobCount: 0, startedAt: nowIso, finishedAt: null }).run();

  // 不经 shell:参数数组原样传递,libuv 负责给含空格的参数(如 --keyword "AI Agent")加引号;
  // shell:true 会把空格参数手动拼接进命令行,导致 "AI Agent" 被拆成两个 argv(回归根因)。
  // PYTHONUNBUFFERED 关闭 python 输出缓冲:进度实时流式回传(否则管道模式下日志积压到退出才出现,
  // 页面显示"0 字符");该变量对非 python 解释器无副作用。
  const child = spawn(pythonCmd, [scriptPath, ...args], {
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
  });
  const running: Running = { child, runId, kind, output: "", startedAt: Date.now() };
  global_.__evodeskJobsRun = running;

  child.stdout?.on("data", (d: Buffer) => { running.output += d.toString("utf-8"); });
  child.stderr?.on("data", (d: Buffer) => { running.output += d.toString("utf-8"); });
  void child.on("close", (code) => {
    const cur = currentRun();
    if (!cur || cur.runId !== runId) return;
    if (kind !== "scrape") {
      finishRun(db, cur, code === 0 ? "ok" : "failed", `退出码 ${code}`);
      return;
    }
    const result = parseScriptResult(cur.output);
    if (!result) {
      // 摘要优先取脚本最后的 "! " 结论行;无则取 traceback 里的异常行(如 RuntimeError: 页面内请求失败…)
      const lines = cur.output.split("\n").map((l) => l.trim());
      const bang = [...lines].reverse().find((l) => l.startsWith("!"));
      const errLine = bang ?? [...lines].reverse().find((l) => /^(RuntimeError|Error|Exception)\b/.test(l));
      finishRun(db, cur, "failed", `${errLine ?? "未解析到 RESULT 结果"}(退出码 ${code})`);
      return;
    }
    const { inserted, updated } = upsertJobs(db, result.jobs, result.searchMeta ?? params);
    finishRun(db, cur, "ok", `新增 ${inserted},更新 ${updated}`, inserted + updated);
  });
  return { runId };
}

/** 取消当前运行:杀掉子进程并落库(等待登录/卡死时的解锁手段)。无运行中任务返回 false。 */
export function cancelCurrentRun(db: Db): boolean {
  const cur = currentRun();
  if (!cur) return false;
  cur.child.kill();
  finishRun(db, cur, "canceled", "已手动取消");
  return true;
}

/** CSV 导出(UTF-8 BOM,Excel 直接打开不乱码) */
export function jobsToCsv(rows: (typeof jobs.$inferSelect)[]): string {
  const head = ["岗位", "薪资", "城市", "区域", "公司", "规模", "经验", "学历", "标签", "链接", "抓取时间"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) => {
    let labels: string[] = [];
    try {
      const parsed: unknown = JSON.parse(r.labels);
      labels = Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === "string") : [];
    } catch { /* 保持空 */ }
    return [r.title, r.salaryDesc, r.city, r.area, r.brand, r.scale, r.experience, r.degree, labels.join("|"), r.url, r.fetchedAt].map(esc).join(",");
  });
  return `\uFEFF${head.map(esc).join(",")}\n${lines.join("\n")}`;
}
