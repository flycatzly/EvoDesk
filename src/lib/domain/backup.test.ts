import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { tasks, providerProfiles, executors } from "@/lib/db/schema";
import { EXPORT_TABLES, exportData, parseBackup, importData, createSnapshot, listSnapshots, cleanSnapshots, backupDir, restoreSnapshotFile, resolveSnapshotName } from "./backup";

const now = () => new Date().toISOString();

let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); seedIfEmpty(db); });

describe("exportData", () => {
  it("覆盖 18 张表;默认剥离 api_key_ref;include_secrets 保留", async () => {
    const n = now();
    db.insert(providerProfiles).values({ id: "p1", name: "P", protocol: "anthropic", apiBase: "https://x", apiKeyRef: "plain:sk-secret", candidates: "[]", source: "manual", enabled: true, createdAt: n }).run();
    db.insert(executors).values({ id: "e1", name: "强模型", type: "llm", role: "planner", apiKeyRef: "plain:sk-abc", enabled: true, createdAt: n }).run();

    const safe = await exportData(db);
    expect(Object.keys(safe.tables).sort()).toEqual([...EXPORT_TABLES].sort());
    const prof = safe.tables.provider_profiles.find((r) => r.id === "p1") as Record<string, unknown>;
    expect(prof.api_key_ref).toBe("");
    const ex = safe.tables.executors.find((r) => r.id === "e1") as Record<string, unknown>;
    expect(ex.api_key_ref).toBe("");

    const full = await exportData(db, { includeSecrets: true });
    expect(((full.tables.provider_profiles.find((r) => r.id === "p1")) as Record<string, unknown>).api_key_ref).toBe("plain:sk-secret");
  });
  it("行数与库一致", async () => {
    const file = await exportData(db);
    expect(file.tables.tasks.length).toBe((db.select().from(tasks).all() as unknown[]).length);
  });
});

describe("parseBackup", () => {
  it("合法文件通过;坏 JSON/version/缺 tables 抛错且消息含原因", async () => {
    const file = await exportData(db);
    expect(parseBackup(JSON.stringify(file)).version).toBe(1);
    expect(() => parseBackup("not json")).toThrow(/JSON/);
    expect(() => parseBackup(JSON.stringify({ ...file, version: 2 }))).toThrow(/version/);
    expect(() => parseBackup(JSON.stringify({ version: 1, exported_at: now(), tables: { evil: [] } }))).toThrow(/未知表/);
    expect(() => parseBackup(JSON.stringify({ version: 1, exported_at: now() }))).toThrow(/tables/);
  });
});

describe("importData", () => {
  it("全量替换:目标库行数等于备份;密钥为空的行不覆盖既有密钥以外的列", async () => {
    db.insert(tasks).values({ id: "extra", title: "多出来的", status: "inbox", tags: "[]", complexity: "S", priority: 0, createdAt: now(), updatedAt: now() }).run();
    const file = await exportData(db); // 此刻 tasks 含 extra
    // 清空任务表模拟另一个库
    const client = (db as unknown as { $client: { prepare: (sql: string) => { run: () => void } } }).$client;
    client.prepare("DELETE FROM tasks").run();
    const stats = await importData(db, file);
    expect(stats.perTable.tasks).toBe(file.tables.tasks.length);
    expect((db.select().from(tasks).all() as unknown[]).length).toBe(file.tables.tasks.length);
  });
  it("单事务:某表行坏(缺列类型错)整体回滚", async () => {
    const file = await exportData(db);
    (file.tables.tasks as unknown[]).push({ id: 12345, title: null }); // 非法行:id 非 text、title null 非法
    await expect(importData(db, file)).rejects.toThrow();
    // 回滚后数据仍在
    expect((db.select().from(tasks).all() as unknown[]).length).toBe(file.tables.tasks.length - 1);
  });
});

describe("snapshot / restore / list / clean", () => {
  it("创建快照文件;restore 后数据回到快照点;列表倒序;clean 只留最近 N 份", async () => {
    const dir = mkdtempSync(join(tmpdir(), "evodesk-backup-"));
    expect(backupDir()).toContain("backups");

    const snap = await createSnapshot(db, dir);
    expect(existsSync(join(dir, snap))).toBe(true);

    // 快照后新增一条,恢复后应消失(文件库:恢复会关连接重开,内存库不支持)
    const { openDb } = await import("@/lib/db/client");
    const fileDbPath = join(dir, "main.db");
    const fileDb = openDb(fileDbPath);
    const beforeFile = (fileDb.select().from(tasks).all() as unknown[]).length;
    const snap2 = await createSnapshot(fileDb, dir);
    fileDb.insert(tasks).values({ id: "after-snap", title: "快照后新增", status: "inbox", tags: "[]", complexity: "S", priority: 0, createdAt: now(), updatedAt: now() }).run();
    expect((fileDb.select().from(tasks).all() as unknown[]).length).toBe(beforeFile + 1);
    restoreSnapshotFile(fileDb, join(dir, snap2));
    // 恢复后重新拿单例(restore 会重开连接)
    const { getDb } = await import("@/lib/db/client");
    const reopened = getDb();
    expect((reopened.select().from(tasks).all() as unknown[]).length).toBe(beforeFile);

    // 多个快照 + 清理
    const { copyFileSync } = await import("node:fs");
    for (let i = 0; i < 23; i++) {
      copyFileSync(join(dir, snap), join(dir, `evodesk-fix-${String(i).padStart(2, "0")}-000000.db`));
    }
    const listed = listSnapshots(dir);
    expect(listed.length).toBe(26); // snap + snap2 + main.db(文件库本身)+ 23 份拷贝
    cleanSnapshots(20, dir);
    expect(readdirSync(dir).filter((f) => f.endsWith(".db")).length).toBe(20);
  });
  it("resolveSnapshotName 拒绝路径穿越与不存在的文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "evodesk-backup2-"));
    expect(() => resolveSnapshotName("../evil.db", dir)).toThrow();
    expect(() => resolveSnapshotName("nope.db", dir)).toThrow();
  });
});
