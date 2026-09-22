"use client";
import { useCallback, useEffect, useState } from "react";

/** 随记接入配置:生成令牌、选随记目录、开关自动 Git 推送;
 *  手机(iOS 快捷指令/Android Tasker/微信转发工具)POST 一句话即存入 Obsidian 随记目录。 */
export function InboundSettings() {
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [subdir, setSubdir] = useState("随记");
  const [autoPush, setAutoPush] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [lanUrl, setLanUrl] = useState<string | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setBaseUrl(window.location.origin);
      void (async () => {
        try {
          const res = await fetch("/api/notes/inbound");
          const d = await res.json();
          setHasToken(d.hasToken);
          if (typeof d.lanUrl === "string") setLanUrl(d.lanUrl);
          const s = await (await fetch("/api/settings")).json();
          const sub = s.settings?.inbound_subdir;
          if (typeof sub === "string" && sub) setSubdir(sub);
          setAutoPush(s.settings?.inbound_git_push === true);
        } catch { /* 读取失败用默认 */ }
      })();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const genToken = async () => {
    const res = await fetch("/api/notes/inbound", { method: "PUT" });
    const data = (await res.json()) as { token?: string };
    if (data.token) { setToken(data.token); setHasToken(true); setMsg("令牌已生成,请立即复制保存(不会再次显示)"); }
  };

  const save = useCallback(async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", { method: "PUT", body: JSON.stringify({ inbound_subdir: subdir.trim() || "随记", inbound_git_push: autoPush }) });
      setMsg(res.ok ? "已保存" : "保存失败");
    } catch {
      setMsg("网络异常");
    } finally {
      setSaving(false);
    }
  }, [subdir, autoPush]);

  const endpoint = `${baseUrl}/api/notes/inbound?token=${token ?? "<令牌>"}`;

  return (
    <div className="surface p-4 max-w-xl">
      <div className="text-sm font-medium mb-2">📥 随记接入(微信/手机 → Obsidian)</div>
      <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
        用手机「快捷指令」(iOS)或 Tasker/HTTP 工具(Android),把一句话 POST 到下面的地址,
        就会原样存进 Obsidian 库的随记目录;开启自动推送后,其他设备的 Obsidian 拉取即见。
        不需要额外主机或微信机器人。
      </p>

      <div className="mb-3">
        {hasToken === null ? (
          <span className="text-xs" style={{ color: "var(--muted)" }}>检查令牌状态…</span>
        ) : hasToken ? (
          <button className="ghost-btn text-xs px-2.5 py-1" onClick={() => void genToken()}>重新生成令牌(旧令牌立即失效)</button>
        ) : (
          <button className="accent-btn text-xs px-2.5 py-1" onClick={() => void genToken()}>生成随记令牌</button>
        )}
      {token && (
        <div className="mt-2 text-xs break-all rounded p-2" style={{ background: "var(--surface-2)", fontFamily: "monospace" }}>
          {endpoint}
          <button className="ghost-btn text-xs px-1.5 py-0.5 ml-2" onClick={() => { void navigator.clipboard.writeText(endpoint); setMsg("已复制接入地址"); }}>复制</button>
        </div>
      )}
      {token && (
        <div className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          {lanUrl ? (
            <>手机/其他设备请用局域网地址(手机与电脑须同一 Wi-Fi):
              <span className="font-mono break-all" style={{ color: "var(--text)" }}>{lanUrl}/api/notes/inbound?token=…</span>
              <button className="ghost-btn text-xs px-1.5 py-0.5 ml-1.5" onClick={() => { void navigator.clipboard.writeText(`${lanUrl}/api/notes/inbound?token=${token ?? ""}`); setMsg("已复制局域网接入地址"); }}>复制</button>
              <div>首次从手机访问不通时,以管理员运行一次:
                <span className="font-mono break-all" style={{ color: "var(--text)" }}>netsh advfirewall firewall add rule name="EvoDesk" dir=in action=allow protocol=TCP localport=3000</span>
              </div>
            </>
          ) : (
            <span>未检测到局域网 IP,手机接入请改用电脑的内网 IP 地址。</span>
          )}
        </div>
      )}
      </div>

      <label className="block mb-3">
        <span className="text-sm block mb-1">随记保存子目录(Obsidian 库内)</span>
        <input className="input w-full px-3 py-2 text-sm" value={subdir} onChange={(e) => setSubdir(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
        <input type="checkbox" checked={autoPush} onChange={(e) => setAutoPush(e.target.checked)} />
        保存后自动 git 提交并推送(需该库已配置 Git 远程;多端 Obsidian 拉取即同步)
      </label>
      <div className="flex items-center gap-2">
        <button onClick={() => void save()} disabled={saving} className="accent-btn px-4 py-2 text-sm">{saving ? "保存中…" : "保存配置"}</button>
        {msg && <span className="text-xs" style={{ color: "var(--accent)" }}>{msg}</span>}
      </div>

      {token && (
        <details className="mt-3">
          <summary className="text-xs cursor-pointer" style={{ color: "var(--muted)" }}>手机快捷指令配置方法(点开)</summary>
          <div className="text-xs mt-2 space-y-1.5" style={{ color: "var(--muted)" }}>
            <div><b style={{ color: "var(--text)" }}>iOS 快捷指令</b>:新建快捷指令 → 添加「要求输入」(提示语:随记)→「URL」填上面的接入地址 →「获取 URL 内容」方法 POST,正文选「JSON」,加字段 text = 提供的输入 → 运行测试。</div>
            <div><b style={{ color: "var(--text)" }}>Android(Tasker/HTTP Request)</b>:事件选任意触发(如通知栏磁贴),HTTP Request POST 到接入地址,Body 传 JSON {'{'}&quot;text&quot;: &quot;随记内容&quot;{'}'}。</div>
            <div><b style={{ color: "var(--text)" }}>微信转发</b>:把聊天里的文字转发给支持 HTTP Webhook 的转发工具(如微秘书/自建 Hook),由它 POST 到本地址,效果等同微信随记机器人。</div>
            <div><b style={{ color: "var(--text)" }}>本机微信(推荐,零配置)</b>:电脑上运行 <span className="font-mono">npm run wechat:bridge</span> 启动剪贴板桥 —— 在 PC 微信里对任何消息「复制」,1-2 秒内自动存入随记目录,无需任何第三方工具或机器人(低封号风险,比 Hook 方案安全)。</div>
            <div>保存成功返回 {'{'}&quot;ok&quot;:true,&quot;file&quot;:&quot;…&quot;{'}'};开启自动推送时其他设备 git pull 即见。</div>
          </div>
        </details>
      )}
    </div>
  );
}
