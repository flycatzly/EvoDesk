// it 回调 async 化:含 await 的 it 块回调改为 async
const fs = require("fs");
const p = "src/lib/domain/runner.test.ts";
let s = fs.readFileSync(p, "utf8");
// 只把 `it("...", () => {` 形式改 async(名称含引号,简单匹配)
s = s.replace(/it\((["'])((?:[^"\\]|\\.)*)\1, \(\) => \{/g, "it($1$2$1, async () => {");
s = s.replace(/it\((`)((?:[^`\\]|\\.)*)`, \(\) => \{/g, "it(`$2`, async () => {");
fs.writeFileSync(p, s);
console.log("asynced");
