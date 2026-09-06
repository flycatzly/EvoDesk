export interface StepDef {
  name: string;
  type: "llm" | "manual" | "checkpoint" | "script";
  executorRole?: string; // llm 步骤:角色绑定(seed 形态),运行时解析
  executor_id?: string;  // script 步骤:执行器 id
  prompt?: string;
  instruction?: string;
  command?: string;
  timeout_ms?: number;
  optional?: boolean;
}
export function getStepDefs(stepsJson: string): StepDef[] {
  return JSON.parse(stepsJson) as StepDef[];
}
