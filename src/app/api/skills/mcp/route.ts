import { NextResponse } from "next/server";
import { discoverMcpConfigs } from "@/lib/domain/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 本机 MCP 服务器扫描:只读解析常见客户端配置文件,不连接不执行
export async function GET() {
  return NextResponse.json({ configs: discoverMcpConfigs() });
}
