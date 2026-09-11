import { getDb } from "@/lib/db/client";
import { executors, providerProfiles } from "@/lib/db/schema";
import { ExecutorsView } from "@/components/ExecutorsView";

export const dynamic = "force-dynamic";

export default function ExecutorsPage() {
  const ex = getDb().select().from(executors).all() as (typeof executors.$inferSelect)[];
  const profiles = getDb().select().from(providerProfiles).all() as (typeof providerProfiles.$inferSelect)[];
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-4">执行器与模型路由</h1>
      <ExecutorsView executors={[...ex]} profiles={[...profiles]} />
    </div>
  );
}
