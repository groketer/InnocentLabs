import type { TaskExecutor } from "./types";

import { websiteAuditExecutor } from "./executors/websiteAudit";
import { prospectingExecutor } from "./executors/prospecting";
import { portfolioRefreshExecutor } from "./executors/portfolioRefresh";
import { emailCampaignExecutor } from "./executors/emailCampaign";
import { deepQualificationExecutor } from "./executors/deepQualification";

const EXECUTORS: TaskExecutor[] = [
  websiteAuditExecutor,
  prospectingExecutor,
  portfolioRefreshExecutor,
  emailCampaignExecutor,
  deepQualificationExecutor,
];

const registry = new Map<string, TaskExecutor>(
  EXECUTORS.map((executor) => [
    executor.taskType,
    executor,
  ])
);

export function getExecutor(
  taskType: string
): TaskExecutor | undefined {
  return registry.get(taskType);
}

export function listTaskTypes(): string[] {
  return Array.from(
    registry.keys()
  );
}