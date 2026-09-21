// runner.test.ts await 化:async 函数调用点全部 await
const fs = require("fs");
const p = "src/lib/domain/runner.test.ts";
let s = fs.readFileSync(p, "utf8");
const fns = [
  "startRun", "getRun", "getSteps", "getCurrentStep", "getStepDefsForRun",
  "retryStep", "manualOverrideStep", "skipStep", "markStepFailed",
  "persistStepTerminal", "approveCheckpoint", "rejectCheckpoint", "runLlmStep",
];
for (const fn of fns) {
  const re = new RegExp("(?<!await |function |async function )" + fn + "\\(db", "g");
  s = s.replace(re, "await " + fn + "(db");
}
// 也处理可能跨行格式:startRun(db, 已覆盖;单独的 startRun(db
s = s.replace(/(?<!await )(startRun)\(db\.taskId/g, "await $1(db.taskId");
fs.writeFileSync(p, s);
console.log("done");
