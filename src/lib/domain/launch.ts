import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function sanitizeModelName(model: string): string {
  return model.replace(/[[\]*?"<>|/:\\]/g, "_");
}

/** 模型名白名单:仅字母数字与 . _ : @ -。供 spawnClaude 与路由层(Task 6)复用。 */
export function isValidModelName(model: string): boolean {
  return /^[A-Za-z0-9._:@-]+$/.test(model);
}

/** launch 型 payload 解析({profile_id, model?, workdir?});非法 JSON/缺 profile_id 返回 null。
 * preview/confirm 两路由共用:解析失败由调用方映射状态码(两处现行为一致,均为 400),勿在本函数内改语义。 */
export function parseLaunchPayload(payload: string): { profile_id: string; model?: string; workdir?: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.profile_id !== "string" || !o.profile_id.trim()) return null;
  return { profile_id: o.profile_id, model: typeof o.model === "string" ? o.model : undefined, workdir: typeof o.workdir === "string" ? o.workdir : undefined };
}

export function buildLaunchSettings(raw: string, model: string | null): string {
  // 安全:生成的 settings 含密钥(ANTHROPIC_AUTH_TOKEN),只落 data/generated/(已 gitignore 的 /data/ 下);
  // 调用方(路由,Task 6)须在启动成功后延迟删除该临时文件,避免明文密钥长期驻留磁盘。
  const cfg = JSON.parse(raw) as Record<string, unknown>;
  const env = (cfg.env ?? {}) as Record<string, unknown>;
  if (model) {
    env.ANTHROPIC_MODEL = model;
    cfg.model = model;
  }
  cfg.env = env;
  const outDir = path.join(process.cwd(), "data", "generated");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `launch-${sanitizeModelName(model ?? "default")}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), "utf8");
  return file;
}

export function spawnClaude(settingsPath: string, model: string | null, workdir: string, dryRun: boolean): Promise<{ status: "ok" | "failed"; detail: string }> {  // 防注入:spawn 带 shell:true 时参数经 cmd.exe 拼接,模型名若含 & | ; 等元字符即可执行任意命令
  // (模型名来自导入的 profile / 用户 payload)。白名单校验对 dryRun 也生效(fail closed):
  // 预览不得把不可安全执行的命令当作可运行命令展示。校验先于预检,非法名绝不触发 spawn。
  if (model && !isValidModelName(model)) {
    return Promise.resolve({ status: "failed", detail: `模型名含非法字符:${model}` });
  }
  const args = ["--settings", settingsPath, ...(model ? ["--model", model] : [])];
  if (dryRun) {
    // DryRun 的意义就是不依赖环境:不做 claude.cmd 预检,仅返回命令预览
    return Promise.resolve({ status: "ok", detail: `claude.cmd ${args.join(" ")} (工作目录:${workdir})` });
  }
  // 预检:shell:true 下 spawn 事件在 cmd.exe 进程启动时即触发,claude.cmd 缺失也会假成功(spec §10.3),
  // 故先 where 探测安装状态。
  try {
    execSync("where claude.cmd", { stdio: "pipe" });
  } catch {
    return Promise.resolve({ status: "failed", detail: "未找到 claude.cmd,请先 npm install -g @anthropic-ai/claude-code" });
  }
  // 仍需 shell:true:Node 在 Windows 上不经 shell 无法直接 CreateProcess 一个 .cmd(PATHEXT 解析)。
  // 注入面已收口:settingsPath 双引号包裹(路径含空格不断参数),模型名经 isValidModelName 白名单,
  // 两者拼接后不含可被 cmd.exe 解释的元字符。
  const argStr = `--settings "${settingsPath}"${model ? ` --model ${model}` : ""}`;
  return new Promise((resolve) => {
    const child = spawn("claude.cmd", [argStr], { cwd: workdir, windowsHide: true, stdio: "ignore", shell: true });
    child.on("error", (e) => resolve({ status: "failed", detail: String(e).slice(0, 200) }));
    child.on("spawn", () => { child.unref(); resolve({ status: "ok", detail: "已启动新终端窗口" }); });
  });
}

/** 清扫残留的含密钥临时 settings(进程崩溃错过 1s 删除时兜底);由 quick-actions 路由在 GET/confirm 时调用。 */
export function sweepStaleSettings(maxAgeMs = 5 * 60_000, dir = path.join(process.cwd(), "data", "generated")): number {
  let removed = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith("launch-") || !f.endsWith(".json")) continue;
      const p = path.join(dir, f);
      try {
        if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) { fs.rmSync(p, { force: true }); removed++; }
      } catch { /* 单文件失败忽略 */ }
    }
  } catch { /* 目录不存在 */ }
  return removed;
}
