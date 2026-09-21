// 分类剩余路由复杂度:0 run+0 all0 = 简单(仅 getDb 传 domain 函数,改动小)
const fs = require("fs");
const path = require("path");
const routes = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (p.endsWith("route.ts") && !p.endsWith(".test.ts")) routes.push(p);
  }
};
walk("src/app/api");
const rows = [];
for (const f of routes) {
  const s = fs.readFileSync(f, "utf8");
  if (!s.includes("getDb()")) continue;
  const run = (s.match(/\.run\(\)/g) || []).length;
  const all0 = (s.match(/\.all\(\)\[0\]/g) || []).length;
  const all = (s.match(/\.all\(\)/g) || []).length;
  rows.push({ f: f.split(path.sep).join("/"), run, all0, all });
}
rows.sort((a, b) => (a.run + a.all0) - (b.run + b.all0));
for (const r of rows) console.log(`${r.run}\t${r.all0}\t${r.all}\t${r.f}`);
console.log("total:", rows.length);
