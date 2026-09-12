import { getDb } from "@/lib/db/client";
import { executors, providerProfiles } from "@/lib/db/schema";
import { ExecutorsView } from "@/components/ExecutorsView";

export const dynamic = "force-dynamic";

// RSC 会把传给客户端组件的 props 序列化进内联 self.__next_f 脚本,密钥材料必须在 props 边界就地掩码:
// env:NAME 不含秘密原样保留;plain: 引用一律折叠为裸词 "plain"(不携带冒号后的密钥)
const maskRef = (ref: string | null) => (ref?.startsWith("env:") ? ref : ref ? "plain" : null);

export default function ExecutorsPage() {
  const ex = getDb().select().from(executors).all() as (typeof executors.$inferSelect)[];
  const profiles = getDb().select().from(providerProfiles).all() as (typeof providerProfiles.$inferSelect)[];
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-4">执行器与模型路由</h1>
      <ExecutorsView
        executors={ex.map((e) => ({ ...e, apiKeyRef: maskRef(e.apiKeyRef) }))}
        profiles={profiles.map((p) => ({ ...p, apiKeyRef: maskRef(p.apiKeyRef) }))}
      />
    </div>
  );
}
