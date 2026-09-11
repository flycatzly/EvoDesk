import { spawn } from "node:child_process";

export function shellCommand(shell: string, command: string): { file: string; args: string[] } {
  switch (shell) {
    case "cmd": return { file: "cmd", args: ["/c", command] };
    case "bash": return { file: "bash", args: ["-c", command] };
    case "python": return { file: "python", args: ["-c", command] };
    default: return { file: "powershell", args: ["-NoProfile", "-Command", command] };
  }
}

export interface ScriptResult { output: string; exitCode: number | null; durationMs: number; timedOut: boolean }

const MAX_OUTPUT_CHARS = 65_536;

export function executeScript(shell: string, command: string, opts: { cwd: string; timeoutMs: number }): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const { file, args } = shellCommand(shell, command);
    const child = spawn(file, args, { cwd: opts.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => { if (out.length < MAX_OUTPUT_CHARS) out += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { if (out.length < MAX_OUTPUT_CHARS) out += d.toString(); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, opts.timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ output: (out + "\n" + e.message).slice(0, MAX_OUTPUT_CHARS), exitCode: null, durationMs: Date.now() - started, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ output: out.slice(0, MAX_OUTPUT_CHARS), exitCode: code, durationMs: Date.now() - started, timedOut });
    });
  });
}
