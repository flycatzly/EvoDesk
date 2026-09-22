#!/usr/bin/env node
// 微信/任意应用 → Obsidian 随记 桥:监听 Windows 剪贴板,复制即同步。
//
// 用法(微信里「复制」一条消息,1-2 秒内自动存入 Obsidian 随记目录):
//   node scripts/wechat-bridge.mjs                 # 自动从 data/evodesk.db 读令牌,服务取 localhost:3000
//   node scripts/wechat-bridge.mjs --url http://localhost:3000 --token <令牌>
//
// 行为:
//   · 每 1.2s 读取剪贴板文本,内容变化且非空才同步(与上次成功内容去重)
//   · 跳过图片/文件引用(非文本),跳过 < 2 字符的误触
//   · 同步成功打印落盘文件名;失败打印原因并继续监听
//   · Ctrl+C 停止
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};

// ---- 解析服务地址与令牌 ----
let baseUrl = argOf("--url") ?? "http://localhost:3000";
let token = argOf("--token");

if (!token) {
  // 与应用同一份本地库,直接读设置(只读连接,不干扰运行中的服务)
  try {
    const { createRequire } = await import("node:module");
    const require2 = createRequire(path.join(ROOT, "package.json"));
    const Database = require2("better-sqlite3");
    const db = new Database(path.join(ROOT, "data", "evodesk.db"), { readonly: true });
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key='inbound_token'").get();
      token = row ? JSON.parse(row.value) : null;
    } finally {
      db.close();
    }
  } catch (e) {
    console.error("读取令牌失败:", e.message?.slice(0, 120));
  }
}
if (!token) {
  console.error("未找到随记令牌:先在 EvoDesk 设置页「随记接入」生成令牌,或用 --token 传入。");
  process.exit(1);
}
const endpoint = `${baseUrl.replace(/\/$/, "")}/api/notes/inbound?token=${encodeURIComponent(token)}`;

// ---- 剪贴板读取(Windows PowerShell;失败自动试 macOS pbpaste / Linux xclip)----
async function readClipboard() {
  if (process.platform === "win32") {
    // 先把控制台输出编码切到 UTF-8:否则中文内容按系统 OEM 码页(GBK)输出,Node 按 UTF-8 解码必乱码
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -TextFormatType Text"],
      { timeout: 5000 },
    );
    return stdout.replace(/\r\n$/, "");
  }
  const cmd = process.platform === "darwin" ? "pbpaste" : "xclip";
  const args = process.platform === "darwin" ? [] : ["-selection", "clipboard", "-o"];
  const { stdout } = await execFileAsync(cmd, args, { timeout: 5000 });
  return stdout.replace(/\n$/, "");
}

// ---- 主循环 ----
let last = "";        // 上一次剪贴板内容(无论成功与否都记,避免失败后无限重试)
let lastSynced = "";  // 上一次成功同步的内容(重启后首条不重复推)

console.log("📥 微信随记桥已启动:在微信(或任意应用)里「复制」文字,即自动存入 Obsidian 随记。Ctrl+C 停止。");
console.log(`   服务: ${baseUrl}  |  令牌: ${token.slice(0, 6)}…`);

setInterval(async () => {
  let text = "";
  try {
    text = await readClipboard();
  } catch {
    return; // 剪贴板被占用/含非文本,静默跳过
  }
  if (!text || text.length < 2 || text === last) return;
  last = text;
  if (text === lastSynced) return;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, title: text.split("\n")[0].slice(0, 20) || "微信随记" }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) {
      lastSynced = text;
      console.log(`✓ 已同步随记: ${data.file}${data.gitNote ? ` | ${data.gitNote}` : ""}`);
    } else {
      console.error(`✗ 同步失败(${res.status}): ${(data?.error ?? "").slice(0, 80)}`);
    }
  } catch (e) {
    console.error(`✗ 无法连接服务(${e.cause?.code ?? e.message?.slice(0, 60)}):确认 EvoDesk 正在运行`);
  }
}, 1200);
