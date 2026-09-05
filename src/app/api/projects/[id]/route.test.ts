import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { projects } from "@/lib/db/schema";
import { PATCH } from "./route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);

let projectId = "";
beforeEach(() => {
  const db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
  projectId = (db.select().from(projects).all() as (typeof projects.$inferSelect)[])[0].id;
});

describe("PATCH /api/projects/[id]", () => {
  it("更新 name(去首尾空格)与 archived", async () => {
    const res = await PATCH(
      req(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ name: "  副业  ", archived: true }) }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project.name).toBe("副业");
    expect(data.project.archived).toBe(true);
  });
  it("非对象 body(无可更新字段)返回 400", async () => {
    const res = await PATCH(
      req(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify("nope") }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(400);
  });
  it("未知 id 返回 404", async () => {
    const res = await PATCH(
      req("/api/projects/nope", { method: "PATCH", body: JSON.stringify({ name: "x" }) }),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(res.status).toBe(404);
  });
});
