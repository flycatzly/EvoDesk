// 批量双方言转换 v2(基于验证:两方言 builder 都 then-able,await 返回兼容结构)
// SQLite: await insert → {changes,...}; await select → 行数组
// MySQL:  await builder → [rows, fields](select)/ ResultSetHeader(insert)
// 转换规则(保守,仅单行语句):
//   X.select()....all()     → await X.select()...
//   X.select()....all()[0]  → (await X.select()...)[0]
//   X.insert/update/delete(...).run() → await X.insert/update/delete(...)
//   const db = getDb()      → const db = await getAnyDb()(getAnyDb 泛型)
// 配套 import:q 无需引入(await 原生即可;但保持 q 用于 changes 归一的复杂场景)
const fs = require("fs");
const path = require("path");

function convertFile(f) {
  let s = fs.readFileSync(f, "utf8");
  const orig = s;
  // import(若文件使用了 getDb 且尚未有 data-source)
  if (s.includes('getDb()') && !s.includes('from "@/lib/db/data-source"')) {
    s = s.replace('import { getDb } from "@/lib/db/client";',
      'import { getAnyDb } from "@/lib/db/data-source";');
  }
  // const db = getDb() → const db = await getAnyDb()
  s = s.replace(/const db = getDb\(\);/g, "const db = await getAnyDb();");
  s = s.replace(/= getDb\(\)\./g, "= (await getAnyDb()).");
  s = s.replace(/getDb\(\)\.select\(\)/g, "(await getAnyDb()).select()");
  s = s.replace(/getDb\(\)\.insert\(/g, "(await getAnyDb()).insert(");
  s = s.replace(/getDb\(\)\.update\(/g, "(await getAnyDb()).update(");
  s = s.replace(/getDb\(\)\.delete\(/g, "(await getAnyDb()).delete(");
  // 链尾:select 链 .all()[0] / .all()(单行内,非嵌套多层括号)
  s = s.replace(/(\(await getAnyDb\(\)\)\.select\(\)[^;\n]*?)\.all\(\)\[0\]/g, "(await $1)[0]");
  s = s.replace(/(\(await getAnyDb\(\)\)\.select\(\)[^;\n]*?)\.all\(\)/g, "(await $1)");
  // 链尾:insert/update/delete(...).run()
  s = s.replace(/(\(await getAnyDb\(\)\)\.(?:insert|update|delete)\([^;\n]*?\))\.run\(\)/g, "await $1");
  // 独立 .run() 残留(delete 链等)
  s = s.replace(/(\(await getAnyDb\(\)\)\.(?:delete|update|insert)[^;\n]*?)\.run\(\)/g, "await $1");

  if (s !== orig) { fs.writeFileSync(f, s); return true; }
  return false;
}

for (const f of process.argv.slice(2)) {
  console.log(convertFile(f) ? "converted:" : "unchanged:", f);
}
