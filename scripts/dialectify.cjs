// 批量双方言转换:routes 里 (await getAnyDb()) 形态的同步链
// 覆盖模式(单语句,非跨多行):
//   X.select()....all()      → await q.all(X.select()...)
//   X.select()....all()[0]   → await q.one(X.select()...)
//   X.insert/update/delete(...).run() → await q.run(X.insert/update/delete(...))
//   X.select()....all() as T → await q.all<T或原as>(...)
// 用法:node scripts/dialectify.cjs <file...>
const fs = require("fs");

function convert(s) {
  let n = 0;
  // 1. import
  if (!s.includes('from "@/lib/db/data-source"')) {
    s = s.replace('import { getDb } from "@/lib/db/client";',
      'import { getDb, dbDialect } from "@/lib/db/client";\nimport { getAnyDb } from "@/lib/db/data-source";\nimport { q } from "@/lib/db/q";');
    n++;
  }
  // 2. const db = getDb() → await(仅函数内;用常见赋值形态)
  s = s.replace(/^(\s*)const db = getDb\(\);/gm, "$1const db = await getAnyDb();");
  s = s.replace(/getDb\(\)\.select\(\)/g, "(await getAnyDb()).select()");
  s = s.replace(/getDb\(\)\.insert\(/g, "(await getAnyDb()).insert(");
  s = s.replace(/getDb\(\)\.update\(/g, "(await getAnyDb()).update(");
  s = s.replace(/getDb\(\)\.delete\(/g, "(await getAnyDb()).delete(");
  // 3. 链尾 .all()[0] → 由 q 包装:整体语句形态(行内),保守处理
  //    (await getAnyDb()).select()....all()[0] → (await q.one((await getAnyDb()).select()....))
  s = s.replace(/\(await getAnyDb\(\)\)\.select\(\)([^;\n]*?)\.all\(\)\[0\]/g, "(await q.one((await getAnyDb()).select()$1))");
  s = s.replace(/\(await getAnyDb\(\)\)\.select\(\)([^;\n]*?)\.all\(\)/g, "(await q.all((await getAnyDb()).select()$1))");
  // 4. run
  s = s.replace(/\(await getAnyDb\(\)\)\.(insert|update|delete)\(([^;\n]*?)\)\.run\(\)/g, "(await q.run((await getAnyDb()).$2($3)))");
  return s;
}

for (const f of process.argv.slice(2)) {
  const before = fs.readFileSync(f, "utf8");
  const after = convert(before);
  if (before !== after) {
    fs.writeFileSync(f, after);
    console.log("converted:", f);
  } else {
    console.log("unchanged:", f);
  }
}
