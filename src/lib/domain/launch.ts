import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface LaunchSpec { profileName: string; apiBase: string; apiKeyRef: string; model: string | null; workdir: string }

export function sanitizeModelName(model: string): string {
  return model.replace(/[[\]*?"<>|/:\\]/g, "_");
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

export function spawnClaude(settingsPath: string, model: string | null, workdir: string, dryRun: boolean): Promise<{ status: "ok" | "failed"; detail: string }> {
  const args = ["--settings", settingsPath, ...(model ? ["--model", model] : [])];
  if (dryRun) return Promise.resolve({ status: "ok", detail: `claude.cmd ${args.join(" ")} (工作目录:${workdir})` });
  // shell:true 使 claude.cmd 经 PATH 解析(复刻 launcher.ps1 行为)
  return new Promise((resolve) => {
    const child = spawn("claude.cmd", args, { cwd: workdir, windowsHide: true, stdio: "ignore", shell: true });
    child.on("error", (e) => resolve({ status: "failed", detail: String(e).slice(0, 200) }));
    child.on("spawn", () => { child.unref(); resolve({ status: "ok", detail: "已启动新终端窗口" }); });
  });
}
