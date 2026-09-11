import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { executors } from "@/lib/db/schema";
import { executorLlmConfig, callLlm } from "@/lib/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 连通性测试:结果走 200 + ok 布尔(业务失败不是 HTTP 失败);错误信息只含端点/原因,不回显密钥值
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ex = getDb().select().from(executors).where(eq(executors.id, id)).all()[0];
  if (!ex) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (ex.type !== "llm") return NextResponse.json({ error: "仅 llm 执行器支持连通性测试" }, { status: 400 });
  let cfg;
  try { cfg = executorLlmConfig(ex); } catch (e) { return NextResponse.json({ ok: false, error: String(e) }, { status: 200 }); }
  if (!cfg.apiKey) return NextResponse.json({ ok: false, error: "API key 未配置(apiKeyRef 指向的环境变量不存在)" }, { status: 200 });
  try {
    const r = await callLlm(cfg, [{ role: "user", content: "回复 pong 两个字母以内" }]);
    return NextResponse.json({ ok: true, reply: r.text.slice(0, 50), model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 300) }, { status: 200 });
  }
}
