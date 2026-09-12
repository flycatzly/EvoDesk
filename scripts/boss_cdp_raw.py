#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BOSS直聘 CDP 抓取脚本(EvoDesk 求职雷达托管端)。

技术方案(来自需求文档,2026-09):
  启动带 CDP 端口的 Chrome(持久隔离 profile ~/.boss-zhipin-scraper/chrome-profile)
  → WebSocket 连接 CDP → 在 zhipin.com 页面内注入 JS,XHR 同步调用搜索 API
  → 提取明文 salaryDesc 等字段 → 按 job_id 去重、增量保存、JSON/CSV 输出。

守门(内置,不可关闭):单次最多 10 页、页间随机 12-22s 延迟、隔离 profile、
仅使用本人已登录会话。仅限个人求职研究,请勿大规模抓取;尊重 robots.txt 与网站条款。

重要:接口路径与字段按需求文档实现,未对线上接口逐一验证(离线环境)。
首次使用:先 --setup-chrome 并在弹出的 Chrome 里登录 zhipin.com,再 --smoke-test 验证。

依赖:仅 Python 3.8+ 标准库(内置极简 WebSocket 客户端,无第三方包)。
"""
import argparse
import base64
import csv
import hashlib
import json
import os
import random
import shutil
import socket
import struct
import sys
import time
import urllib.request
from pathlib import Path

CDP_HOST = "127.0.0.1"
CDP_PORT = 9222
PROFILE_DIR = Path.home() / ".boss-zhipin-scraper" / "chrome-profile"
DEFAULT_OUTPUT_DIR = Path.home() / ".boss-zhipin-scraper" / "job-result"
MAX_PAGES = 10
PAGE_DELAY = (12, 22)
HOME_URL = "https://www.zhipin.com/"

# 常用城市 code(zhipin 站点惯例);未知城市若为纯数字直接透传,否则留空(全国)
CITY_CODES = {
    "北京": "101010100", "上海": "101020100", "广州": "101280100", "深圳": "101280600",
    "杭州": "101210100", "成都": "101270100", "南京": "101190100", "武汉": "101200100",
    "西安": "101110100", "苏州": "101190400", "长沙": "101250100", "郑州": "101180100",
    "重庆": "101040100", "天津": "101030100", "合肥": "101220100", "厦门": "101230200",
}


def log(msg: str) -> None:
    print(f"✓ {msg}", flush=True)


def warn(msg: str) -> None:
    print(f"! {msg}", flush=True)


def resolve_city(city: str) -> str:
    if not city:
        return ""
    if city in CITY_CODES:
        return CITY_CODES[city]
    if city.isdigit():
        return city
    warn(f"未知城市「{city}」,按全国范围搜索(可在 CITY_CODES 中补充)")
    return ""


# ---------- 极简 WebSocket 客户端(RFC6455,仅满足 CDP 文本帧收发) ----------

class WsClient:
    def __init__(self, host: str, port: int, ws_path: str):
        self.sock = socket.create_connection((host, port), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {ws_path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("WebSocket 握手无响应")
            resp += chunk
        head = resp.split(b"\r\n\r\n")[0].decode("latin-1")
        if "101" not in head.split("\r\n")[0]:
            raise ConnectionError(f"WebSocket 握手失败:{head.splitlines()[0]}")
        self._buf = resp.split(b"\r\n\r\n", 1)[1]
        self._msg_id = 0

    def _recv_exact(self, n: int) -> bytes:
        while len(self._buf) < n:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("WebSocket 连接中断")
            self._buf += chunk
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def _recv_frame(self) -> bytes:
        b1, b2 = self._recv_exact(2)
        opcode = b1 & 0x0F
        length = b2 & 0x7F
        if length == 126:
            length = struct.unpack(">H", self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._recv_exact(8))[0]
        payload = self._recv_exact(length)
        if opcode == 9:  # ping → pong
            self._send_frame(10, payload)
            return self._recv_frame()
        if opcode == 8:
            raise ConnectionError("WebSocket 对端关闭")
        return payload

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        mask = os.urandom(4)
        header = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def evaluate(self, expression: str, timeout: float = 30.0) -> str:
        """Runtime.evaluate(returnByValue, awaitPromise);返回字符串值,失败抛异常。"""
        self._msg_id += 1
        self._send_frame(1, json.dumps({
            "id": self._msg_id, "method": "Runtime.evaluate",
            "params": {"expression": expression, "returnByValue": True, "awaitPromise": True},
        }).encode())
        deadline = time.time() + timeout
        while time.time() < deadline:
            payload = json.loads(self._recv_frame().decode("utf-8", "replace"))
            if payload.get("id") != self._msg_id:
                continue
            if "error" in payload:
                raise RuntimeError(f"CDP 错误:{payload['error']}")
            result = payload.get("result", {}).get("result", {})
            if result.get("subtype") == "error":
                raise RuntimeError(f"页面执行错误:{result.get('description', '')[:200]}")
            return json.dumps(result.get("value")) if not isinstance(result.get("value"), str) else result["value"]
        raise TimeoutError("Runtime.evaluate 超时")

    def close(self) -> None:
        try:
            self._send_frame(8, b"")
            self.sock.close()
        except OSError:
            pass


# ---------- CDP HTTP 端点 ----------

def cdp_http(path: str, timeout: float = 5.0) -> dict:
    with urllib.request.urlopen(f"http://{CDP_HOST}:{CDP_PORT}{path}", timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def cdp_ok() -> bool:
    try:
        cdp_http("/json/version", timeout=2.0)
        return True
    except (OSError, ValueError):
        return False


def find_chrome() -> str:
    found = shutil.which("chrome") or shutil.which("google-chrome") or shutil.which("msedge")
    if found:
        return found
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    raise FileNotFoundError("未找到 Chrome/Edge,请用 --chrome 指定浏览器可执行文件路径")


def open_zhipin_tab() -> tuple:
    """打开(或复用)zhipin.com 标签页,返回 (WsClient, target_id)。"""
    for target in cdp_http("/json/list"):
        if target.get("type") == "page" and "zhipin.com" in target.get("url", ""):
            ws = target["webSocketDebuggerUrl"].split(f"{CDP_HOST}:{CDP_PORT}", 1)[1]
            return WsClient(CDP_HOST, CDP_PORT, ws), target["id"]
    new_target = cdp_http(f"/json/new?{HOME_URL}")
    ws = new_target["webSocketDebuggerUrl"].split(f"{CDP_HOST}:{CDP_PORT}", 1)[1]
    return WsClient(CDP_HOST, CDP_PORT, ws), new_target["id"]


# ---------- 页面内 JS(与需求文档一致:XHR 同步调用,与正常浏览行为同源) ----------

SEARCH_JS = """(function(){
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/wapi/zpsearch/boss/search/joblist.json?scene=1&query=' +
      encodeURIComponent('__KW__') + '&city=__CITY__&page=__PAGE__&pageSize=30', false);
    xhr.send(null);
    return xhr.responseText;
  } catch (e) { return JSON.stringify({fetchError: String(e)}); }
})()"""

DETAIL_JS = """(function(){
  var jd = document.querySelector('.job-sec-text');
  var tags = Array.prototype.map.call(
    document.querySelectorAll('.job-keyword-list li, .job-tags span'),
    function(x){ return (x.innerText || '').trim(); }).filter(Boolean);
  return JSON.stringify({jd: jd ? jd.innerText : '', tags: tags});
})()"""


def extract_jobs(payload: str, fetch_city: str) -> list:
    data = json.loads(payload)
    if data.get("fetchError"):
        raise RuntimeError(
            "页面内 XHR 请求失败(常见原因:未登录 / 被风控拦截 / 网络异常)。"
            "请先执行 --setup-chrome,在弹出的专用浏览器里登录 zhipin.com,再重新抓取。"
        )
    if data.get("code") not in (0, None):
        code = data.get("code")
        if code in (101600, 1001, 1002):
            raise RuntimeError(
                "登录态失效或触发风控(code=%s):请在 BOSS 专用 Chrome 里重新登录 zhipin.com 后重试" % code
            )
        raise RuntimeError(f"搜索 API 返回异常 code={code} msg={data.get('message', '')}")
    zpData = data.get("zpData", {})
    out = []
    for j in zpData.get("jobList", []) or []:
        labels = [t for t in (j.get("jobLabels") or []) if isinstance(t, str)]
        if j.get("skills") and isinstance(j.get("skills"), list):
            labels = labels + [s for s in j["skills"] if isinstance(s, str)]
        job_id = j.get("encryptJobId") or j.get("jobId") or ""
        lid = j.get("lid") or ""
        sec = j.get("securityId") or ""
        out.append({
            "jobId": str(job_id),
            "title": j.get("jobName") or "",
            "salaryDesc": j.get("salaryDesc") or "",
            "city": j.get("cityName") or fetch_city or "",
            "area": j.get("areaDistrict") or j.get("businessDistrict") or "",
            "brand": j.get("brandName") or "",
            "scale": j.get("brandScaleName") or "",
            "experience": j.get("jobExperience") or "",
            "degree": j.get("jobDegree") or "",
            "labels": labels[:10],
            "url": f"https://www.zhipin.com/job_detail/{job_id}.html?lid={lid}&securityId={sec}" if job_id else "",
            "securityId": sec or None,
            "lid": lid or None,
        })
    return out


def fetch_detail(ws: WsClient, job: dict) -> None:
    """进详情页抓 JD 与技能标签(带列表返回的 securityId/lid 上下文)。"""
    if not job.get("url"):
        return
    ws.evaluate(f"location.href = {json.dumps(job['url'])}")
    time.sleep(random.uniform(3.0, 5.0))
    raw = ws.evaluate(DETAIL_JS)
    try:
        detail = json.loads(raw)
        job["jd"] = (detail.get("jd") or "")[:20000]
        job["labels"] = (job.get("labels") or []) + [t for t in detail.get("tags", []) if t][:10 - len(job.get("labels") or [])]
    except (ValueError, TypeError):
        warn("详情页解析失败,跳过 JD")


# ---------- 输出 ----------

def save_json(path: Path, jobs: list, merge_from: Path | None) -> None:
    merged = {}
    if merge_from and merge_from.exists():
        try:
            for j in json.loads(merge_from.read_text(encoding="utf-8")).get("jobs", []):
                merged[j.get("jobId")] = j
        except (ValueError, OSError) as e:
            warn(f"合并源读取失败:{e}")
    for j in jobs:
        merged[j.get("jobId")] = j
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"jobs": list(merged.values())}, ensure_ascii=False, indent=1), encoding="utf-8")


def save_csv(path: Path, jobs: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["岗位", "薪资", "城市", "区域", "公司", "规模", "经验", "学历", "标签", "链接"])
        for j in jobs:
            w.writerow([j.get("title"), j.get("salaryDesc"), j.get("city"), j.get("area"), j.get("brand"),
                        j.get("scale"), j.get("experience"), j.get("degree"), "|".join(j.get("labels") or []), j.get("url")])


# ---------- 命令 ----------

def cmd_setup_chrome(args) -> None:
    chrome = args.chrome or find_chrome()
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    log(f"隔离 profile:{PROFILE_DIR}(不软链、不复制主 Chrome)")
    if cdp_ok():
        log("CDP 端口已在运行,复用现有 Chrome 实例")
    else:
        import subprocess
        subprocess.Popen(
            [chrome, f"--remote-debugging-port={CDP_PORT}", f"--user-data-dir={PROFILE_DIR}",
             "--no-first-run", "--no-default-browser-check", HOME_URL],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            time.sleep(1)
            if cdp_ok():
                break
        else:
            sys.exit("! CDP 端口未就绪,请检查浏览器是否启动")
        log(f"已启动 {chrome}(CDP:{CDP_PORT})")
    log("请在弹出的浏览器窗口中登录 zhipin.com(登录态会保留在本 profile,重启机器仍在)")
    log("等待搜索接口返回明文 salaryDesc(登录完成后自动通过,最多等 5 分钟)…")
    deadline = time.time() + 300
    while time.time() < deadline:
        try:
            ws, _ = open_zhipin_tab()
            raw = ws.evaluate(SEARCH_JS.replace("__KW__", "Python").replace("__CITY__", "").replace("__PAGE__", "1"), timeout=20)
            ws.close()
            data = json.loads(raw)
            job_list = (data.get("zpData") or {}).get("jobList") or []
            if data.get("code") == 0 and any(j.get("salaryDesc") for j in job_list):
                log("登录态验证通过:salaryDesc 明文可读,可以开始抓取(--smoke-test 复核)")
                return
        except (OSError, ValueError, RuntimeError, TimeoutError) as e:
            warn(f"等待中:{e}")
        time.sleep(5)
    sys.exit("! 超时:请在 5 分钟内完成登录后重试 --check")


def cmd_check() -> None:
    ok = True
    if cdp_ok():
        log("Chrome CDP 可用")
    else:
        ok = False
        warn("Chrome CDP 不可用:先执行 --setup-chrome")
    try:
        import importlib
        importlib.import_module("json")  # 自检:标准库环境正常
        log("Python 依赖齐全(仅标准库)")
    except ImportError as e:
        ok = False
        warn(f"Python 环境异常:{e}")
    if cdp_ok():
        try:
            ws, _ = open_zhipin_tab()
            raw = ws.evaluate(SEARCH_JS.replace("__KW__", "Python").replace("__CITY__", "").replace("__PAGE__", "1"), timeout=20)
            ws.close()
            data = json.loads(raw)
            if data.get("code") == 0:
                log("BOSS直聘已登录,搜索接口正常")
            else:
                ok = False
                warn(f"登录态异常(code={data.get('code')}),请在专用 Chrome 重新登录")
        except (OSError, ValueError, RuntimeError, TimeoutError) as e:
            ok = False
            warn(f"登录态检查失败:{e}")
    sys.exit(0 if ok else 1)


def cmd_smoke_test(args) -> None:
    if not cdp_ok():
        sys.exit("! Chrome CDP 不可用:先执行 --setup-chrome")
    ws, _ = open_zhipin_tab()
    try:
        raw = ws.evaluate(SEARCH_JS.replace("__KW__", args.keyword).replace("__CITY__", resolve_city(args.city)).replace("__PAGE__", "1"), timeout=20)
        jobs = extract_jobs(raw, args.city)
        log(f"搜索接口正常,第 1 页取到 {len(jobs)} 条(本次不写结果文件)")
        for j in jobs[:5]:
            print(f"✓ {j['title']} | {j['salaryDesc']} | {j['city']} | {j['brand']} | {j['scale']}")
    finally:
        ws.close()


def cmd_scrape(args) -> None:
    if not cdp_ok():
        sys.exit("! Chrome CDP 不可用:先执行 --setup-chrome")
    pages = min(args.pages, MAX_PAGES)
    city_code = resolve_city(args.city)
    ws, _ = open_zhipin_tab()
    all_jobs: dict = {}
    try:
        # 登录预检:第一页请求失败立即给出行动指引,不产生半截 traceback
        try:
            probe = ws.evaluate(
                SEARCH_JS.replace("__KW__", args.keyword).replace("__CITY__", city_code).replace("__PAGE__", "1"),
                timeout=30)
            extract_jobs(probe, args.city)  # 仅校验,不入库
        except RuntimeError as e:
            warn(str(e))
            log("修复步骤:① 点「启动 Chrome」→ ② 在弹出的浏览器窗口登录 zhipin.com → ③ 回本页点「连通自检」→ ④ 重新抓取")
            sys.exit(2)
        for page in range(1, pages + 1):
            raw = ws.evaluate(
                SEARCH_JS.replace("__KW__", args.keyword).replace("__CITY__", city_code).replace("__PAGE__", str(page)),
                timeout=30)
            page_jobs = extract_jobs(raw, args.city)
            new_count = 0
            for j in page_jobs:
                if j["jobId"] and j["jobId"] not in all_jobs:
                    all_jobs[j["jobId"]] = j
                    new_count += 1
            log(f"第 {page}/{pages} 页:{len(page_jobs)} 条(新增 {new_count})")
            # 增量保存:每页写盘,Ctrl+C 不丢已抓数据
            out_path = Path(args.output) if args.output else DEFAULT_OUTPUT_DIR / f"jobs-{args.keyword}-{time.strftime('%Y%m%d-%H%M%S')}.json"
            save_json(out_path.with_suffix(".json"), list(all_jobs.values()), Path(args.merge) if args.merge else None)
            for j in page_jobs:
                if j["jobId"]:
                    print(f"✓ {j['title']} | {j['salaryDesc']} | {j['city']} | {j['brand']} | {j['scale']}")
            if not page_jobs:
                warn("本页无数据,提前结束")
                break
            if page < pages:
                delay = random.uniform(*PAGE_DELAY)
                log(f"等待 {delay:.0f}s(模拟真人浏览节奏)…")
                time.sleep(delay)
    finally:
        ws.close()

    jobs = list(all_jobs.values())
    if not args.no_detail:
        log(f"抓取 {len(jobs)} 个岗位的详情 JD…")
        ws, _ = open_zhipin_tab()
        try:
            for i, j in enumerate(jobs):
                fetch_detail(ws, j)
                if (i + 1) % 5 == 0:
                    save_json(Path(args.output) if args.output else DEFAULT_OUTPUT_DIR / "jobs-merged.json", jobs, Path(args.merge) if args.merge else None)
                if i < len(jobs) - 1:
                    time.sleep(random.uniform(2.0, 4.0))
        finally:
            ws.close()

    out_path = Path(args.output) if args.output else DEFAULT_OUTPUT_DIR / f"jobs-{args.keyword}-{time.strftime('%Y%m%d-%H%M%S')}.json"
    save_json(out_path.with_suffix(".json"), jobs, Path(args.merge) if args.merge else None)
    if args.format == "csv":
        csv_path = out_path.with_suffix(".csv")
        save_csv(csv_path, jobs)
        log(f"CSV 已保存(UTF-8 BOM):{csv_path}")
    log(f"JSON 已保存:{out_path.with_suffix('.json')}(共 {len(jobs)} 条)")
    # 托管端约定:stdout 最后一行 RESULT: 供 EvoDesk 解析入库
    print("RESULT:" + json.dumps({"jobs": jobs, "search_meta": {"keyword": args.keyword, "city": args.city, "pages": pages, "ts": time.strftime("%Y-%m-%dT%H:%M:%S")}}, ensure_ascii=False), flush=True)


def main() -> None:
    p = argparse.ArgumentParser(description="BOSS直聘 CDP 抓取(个人求职研究用途)")
    p.add_argument("--keyword", default="Python", help="搜索关键词")
    p.add_argument("--city", default="", help="城市(中文或 code;未知按全国)")
    p.add_argument("--pages", type=int, default=1, help=f"抓取页数(每页 30 条,最多 {MAX_PAGES})")
    p.add_argument("--format", choices=["json", "csv"], default="json")
    p.add_argument("--output", default="", help="输出文件路径(默认 ~/.boss-zhipin-scraper/job-result/)")
    p.add_argument("--merge", default="", help="合并到既有 JSON(按 job_id 去重)")
    p.add_argument("--no-detail", action="store_true", help="只抓列表,不进详情页抓 JD")
    p.add_argument("--chrome", default="", help="浏览器可执行文件路径(默认自动查找 Chrome/Edge)")
    p.add_argument("--setup-chrome", action="store_true", help="创建/复用隔离 profile 并启动 Chrome,等待登录")
    p.add_argument("--check", action="store_true", help="检查 CDP/依赖/登录态")
    p.add_argument("--smoke-test", action="store_true", help="真实环境自检一次,不写结果文件")
    args = p.parse_args()

    if args.setup_chrome:
        cmd_setup_chrome(args)
    elif args.check:
        cmd_check()
    elif args.smoke_test:
        cmd_smoke_test(args)
    else:
        cmd_scrape(args)


if __name__ == "__main__":
    main()
