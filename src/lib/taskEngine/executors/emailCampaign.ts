/**
 * MILESTONE 3F — Follow-up campaigns.
 *
 * Sends the next due email (initial or follow-up) to prospects whose
 * sequence says it's time — one prospect per subtask, mirroring the same
 * planSubtasks/runSubtask pattern used elsewhere in this codebase, so each
 * individual send is its own bounded unit of work.
 *
 * WHAT THIS DOES NOT DO:
 * - It never contacts anyone who isn't qualification_status = 'qualified'
 *   AND has a verified public email — both already enforced by
 *   listProspectsDueForOutreach().
 * - It never re-sends to anyone unsubscribed, responded (marked manually —
 *   see the Follow-ups view), paused, or already completed.
 * - It cannot detect replies. See Settings/Follow-ups: marking someone
 *   "responded" is a manual action a person takes after seeing a reply in
 *   their own inbox — this app has no inbound email visibility.
 */

import { randomUUID } from "crypto";
import type { AgentTask } from "@/lib/types";
import type { StepResult, SubtaskPlanItem, TaskExecutor } from "../types";

import {
  listProspectsDueForOutreach,
  getProspectById,
  updateProspectSequence,
} from "@/lib/models/prospects";
import { getProductById } from "@/lib/models/products";
import {
  recordEmailSend,
  listSendsForProspect,
  countSendsToday,
} from "@/lib/models/emailSends";
import { getSettings } from "@/lib/models/settings";
import { composeOutreachEmail } from "@/lib/email/composeEmail";
import { sendEmail } from "@/lib/email/sendEmail";

const MAX_BATCH_PER_TASK = 50;

function nowIso() {
  return new Date().toISOString();
}

export const emailCampaignExecutor: TaskExecutor = {
  taskType: "email_campaign",

  async planSubtasks(task: AgentTask): Promise<SubtaskPlanItem[]> {
    const settings = await getSettings();
    const sentToday = await countSendsToday(task.user_id);
    const remainingBudget = settings.daily_send_limit - sentToday;

    if (remainingBudget <= 0) {
      return [];
    }

    const due = await listProspectsDueForOutreach(
      task.user_id,
      Math.min(remainingBudget, MAX_BATCH_PER_TASK)
    );

    return due.map((prospect) => ({
      title: `Email ${prospect.name}`,
      description: `ProspectId: ${prospect.id}`,
    }));
  },

  async runSubtask(
    parent: AgentTask,
    subtask: AgentTask
  ): Promise<StepResult> {
    const idMatch = subtask.description?.match(/ProspectId:\s*(\S+)/);
    const prospectId = idMatch?.[1]?.trim();

    if (!prospectId) {
      return {
        success: false,
        summary: "No prospect was specified for this send.",
        errorMessage: "Missing ProspectId in subtask description.",
        transientFailure: false,
      };
    }

    const prospect = await getProspectById(parent.user_id, prospectId);

    if (!prospect) {
      return {
        success: true,
        summary: "Skipped — prospect no longer exists.",
        resultData: { skipped: true, reason: "prospect_not_found" },
      };
    }

    // Re-check state in case it changed between planning and now (e.g. a
    // person unsubscribed/marked them responded via the Follow-ups view
    // in the meantime).
    if (
      !["not_started", "active"].includes(prospect.sequence_status) ||
      !prospect.email
    ) {
      return {
        success: true,
        summary: `Skipped — sequence is now "${prospect.sequence_status}".`,
        resultData: { skipped: true, reason: prospect.sequence_status },
      };
    }

    const settings = await getSettings();

    if (prospect.emails_sent > settings.max_follow_ups) {
      await updateProspectSequence(parent.user_id, prospect.id, {
        sequence_status: "completed",
      });
      return {
        success: true,
        summary: "Sequence complete — follow-up cap reached.",
        resultData: { skipped: true, reason: "max_follow_ups_reached" },
      };
    }

    // Approval gate: only applies to the FIRST email in a sequence. Once a
    // sequence is active, follow-ups continue on schedule without asking
    // again each time — the person already approved starting it.
    if (
      prospect.sequence_status === "not_started" &&
      settings.require_manual_approval
    ) {
      await updateProspectSequence(parent.user_id, prospect.id, {
        sequence_status: "pending_approval",
      });
      return {
        success: true,
        summary: `${prospect.name}: queued for approval before the first email sends.`,
        resultData: { skipped: true, reason: "pending_approval" },
      };
    }

    if (!prospect.product_id) {
      return {
        success: false,
        summary: "This prospect has no associated product to write about.",
        errorMessage: "Missing product_id.",
        transientFailure: false,
      };
    }

    const product = await getProductById(prospect.product_id);

    if (!product) {
      return {
        success: false,
        summary: "The associated product could not be found.",
        errorMessage: `Product ${prospect.product_id} not found.`,
        transientFailure: false,
      };
    }

    const unsubscribeToken = prospect.unsubscribe_token || randomUUID();

    if (!prospect.unsubscribe_token) {
      await updateProspectSequence(parent.user_id, prospect.id, {
        unsubscribe_token: unsubscribeToken,
      });
    }

    const step = prospect.emails_sent;
    const previousSends = await listSendsForProspect(prospect.id);

    let composed;
    try {
      composed = await composeOutreachEmail({
        prospect,
        product,
        step,
        previousSends,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not compose email.";
      return {
        success: false,
        summary: `Could not compose an email for ${prospect.name}.`,
        errorMessage: message,
        transientFailure: true,
      };
    }

    const sendResult = await sendEmail({
      to: prospect.email,
      subject: composed.subject,
      body: composed.body,
      unsubscribeToken,
    });

    await recordEmailSend({
      user_id: parent.user_id,
      prospect_id: prospect.id,
      task_id: parent.id,
      step,
      subject: composed.subject,
      body: sendResult.finalBody,
      status: sendResult.success ? "sent" : "failed",
      error_message: sendResult.errorMessage,
    });

    if (!sendResult.success) {
      return {
        success: false,
        summary: `Could not send to ${prospect.name}: ${sendResult.errorMessage}`,
        errorMessage: sendResult.errorMessage,
        // SMTP/network issues are worth retrying; a permanently
        // misconfigured SMTP setup will keep failing, which is exactly
        // the visibility a person needs, surfaced via the task's activity
        // log rather than silently swallowed.
        transientFailure: true,
      };
    }

    const newEmailsSent = prospect.emails_sent + 1;
    const isNowComplete = newEmailsSent > settings.max_follow_ups;

    await updateProspectSequence(parent.user_id, prospect.id, {
      sequence_status: isNowComplete ? "completed" : "active",
      emails_sent: newEmailsSent,
      last_sent_at: nowIso(),
      next_send_at: isNowComplete
        ? null
        : new Date(
            Date.now() +
              settings.min_days_between_follow_ups * 24 * 60 * 60 * 1000
          ).toISOString(),
    });

    return {
      success: true,
      summary: `Sent ${step === 0 ? "initial outreach" : `follow-up #${step}`} to ${prospect.name}.`,
      resultData: {
        prospect_id: prospect.id,
        step,
        subject: composed.subject,
        sequence_status: isNowComplete ? "completed" : "active",
      },
    };
  },
};
