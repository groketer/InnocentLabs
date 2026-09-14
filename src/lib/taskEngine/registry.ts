import type { TaskExecutor } from "./types";

import { websiteAuditExecutor } from "./executors/websiteAudit";
import { prospectingExecutor } from "./executors/prospecting";
import { portfolioRefreshExecutor } from "./executors/portfolioRefresh";
import { emailCampaignExecutor } from "./executors/emailCampaign";
import { deepQualificationExecutor } from "./executors/deepQualification";
import { productStudyExecutor } from "./executors/productStudy";
import { productBriefExecutor } from "./executors/productBrief";
import { contentDraftExecutor } from "./executors/contentDraft";

const EXECUTORS: TaskExecutor[] = [
  websiteAuditExecutor,
  prospectingExecutor,
  portfolioRefreshExecutor,
  emailCampaignExecutor,
  deepQualificationExecutor,
  productStudyExecutor,
  productBriefExecutor,
  contentDraftExecutor,
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