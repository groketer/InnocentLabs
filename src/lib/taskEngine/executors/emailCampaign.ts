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
 * - It never re-sends to anyone unsubscribed, responded, paused, or
 *   already completed.
 * - It doesn't send outside a prospect's business hours (see
 *   isBusinessHoursFor). Replies are detected automatically via the
 *   inbound email webhook — see src/app/api/webhooks/resend-inbound.
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
import { isBusinessHoursFor } from "@/lib/timezones";

const MAX_BATCH_PER_TASK = 50;
// Fetch a larger candidate pool than the batch size before filtering by
// business hours, so a run that happens to land when many prospects'
// countries are asleep doesn't artificially under-fill the batch — there
// may be plenty of OTHER due prospects, in different timezones, who are
// actually awake right now.
const CANDIDATE_POOL_MULTIPLIER = 4;

function nowIso() {
  return new Date().toISOString();
}

/**
 * MILESTONE 4I — the core "compose, send, record" logic, extracted so
 * it can be reused both by the scheduled campaign executor below and a
 * new on-demand "send now" action. This assumes eligibility has already
 * been checked by the caller — it does the actual work, not the
 * decision about whether to do it.
 */
export async function composeAndSendOutreachEmail(
  userId: string,
  prospect: Awaited<ReturnType<typeof getProspectById>>
): Promise<StepResult> {
  if (!prospect) {
    return {
      success: true,
      summary: "Skipped — prospect no longer exists.",
      resultData: { skipped: true, reason: "prospect_not_found" },
    };
  }

  if (!prospect.product_id) {
    // MILESTONE 5B — without this, the prospect's sequence_status never
    // advances past "not_started", so it matches
    // listProspectsDueForOutreach() again tomorrow, and every day after
    // — the same doomed send retried forever rather than surfacing once
    // as something a person can actually fix (assign a product, or
    // delete). needs_human_reply is a real, already-monitored status —
    // it shows up in the Dashboard's alerts as something needing
    // attention, rather than silently repeating in the background.
    await updateProspectSequence(userId, prospect.id, {
      sequence_status: "needs_human_reply",
    });
    return {
      success: false,
      summary: "This prospect has no associated product to write about.",
      errorMessage: "Missing product_id.",
      transientFailure: false,
    };
  }

  const product = await getProductById(prospect.product_id);

  if (!product) {
    // MILESTONE 5B — same class of bug as the missing product_id case
    // just above: a product_id pointing at a deleted or nonexistent
    // product would otherwise retry forever too, for the same reason.
    await updateProspectSequence(userId, prospect.id, {
      sequence_status: "needs_human_reply",
    });
    return {
      success: false,
      summary: "The associated product could not be found.",
      errorMessage: `Product ${prospect.product_id} not found.`,
      transientFailure: false,
    };
  }

  const settings = await getSettings();
  const unsubscribeToken = prospect.unsubscribe_token || randomUUID();

  if (!prospect.unsubscribe_token) {
    await updateProspectSequence(userId, prospect.id, {
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

  if (composed.action === "request_info") {
    return {
      success: false,
      summary: `Needs more information about ${product.name} before writing to ${prospect.name}: ${composed.reason}`,
      errorMessage: composed.reason,
      transientFailure: false,
      resultData: {
        prospect_id: prospect.id,
        product_id: product.id,
        reason: composed.reason,
      },
    };
  }

  const sendResult = await sendEmail({
    to: prospect.email!,
    subject: composed.subject,
    body: composed.body,
    unsubscribeToken,
    recipientName: prospect.prospect_type === "person" ? prospect.name : undefined,
  });

  await recordEmailSend({
    user_id: userId,
    prospect_id: prospect.id,
    task_id: null,
    step,
    subject: composed.subject,
    body: sendResult.finalBody,
    status: sendResult.success ? "sent" : "failed",
    error_message: sendResult.errorMessage,
    direction: "outbound",
    message_id: sendResult.messageId,
  });

  if (!sendResult.success) {
    return {
      success: false,
      summary: `Could not send to ${prospect.name}: ${sendResult.errorMessage}`,
      errorMessage: sendResult.errorMessage,
      transientFailure: true,
    };
  }

  const newEmailsSent = prospect.emails_sent + 1;
  const isNowComplete = newEmailsSent > settings.max_follow_ups;

  await updateProspectSequence(userId, prospect.id, {
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

    const batchSize = Math.min(remainingBudget, MAX_BATCH_PER_TASK);

    const candidates = await listProspectsDueForOutreach(
      task.user_id,
      batchSize * CANDIDATE_POOL_MULTIPLIER,
      !settings.require_manual_approval
    );

    // MILESTONE 3R — international-timezone-aware sending. A prospect
    // with no known country falls back to "always eligible" (see
    // isBusinessHoursFor) rather than being permanently blocked by a
    // safeguard that has nothing to check against.
    const due = candidates
      .filter((p) => isBusinessHoursFor(p.country))
      .slice(0, batchSize);

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

    const settings = await getSettings();

    // Re-check state in case it changed between planning and now (e.g. a
    // person unsubscribed/marked them responded via the Follow-ups view in
    // the meantime). A prospect sitting in "pending_approval" is let
    // through here ONLY if approval is no longer required — that's what
    // lets someone stuck there from an earlier run resume automatically
    // once the setting is turned off, instead of staying stuck until
    // manually approved one at a time.
    const isEligibleStatus =
      prospect.sequence_status === "not_started" ||
      prospect.sequence_status === "active" ||
      (prospect.sequence_status === "pending_approval" &&
        !settings.require_manual_approval);

    if (!isEligibleStatus || !prospect.email) {
      return {
        success: true,
        summary: `Skipped — sequence is now "${prospect.sequence_status}".`,
        resultData: { skipped: true, reason: prospect.sequence_status },
      };
    }

    // MILESTONE 3R — re-check business hours at actual send time, not
    // just at planning time. A subtask can sit queued behind others for a
    // while; by the time it's this one's turn, the window that was open
    // when planSubtasks ran may have just closed for this prospect's
    // country. Not a failure — this prospect is simply picked up again
    // whenever the next campaign run happens to catch their business hours.
    if (!isBusinessHoursFor(prospect.country)) {
      return {
        success: true,
        summary: `Skipped — outside business hours for ${prospect.name}'s country (${prospect.country ?? "unknown"}) right now.`,
        resultData: { skipped: true, reason: "outside_business_hours" },
      };
    }

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

    // Approval gate: only applies to the FIRST email in a sequence, and
    // only to a prospect who hasn't been gated before ("not_started" —
    // anyone already in "pending_approval" only reached this line because
    // isEligibleStatus above already confirmed approval is now off, so
    // this deliberately does not re-gate them).
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

    return composeAndSendOutreachEmail(parent.user_id, prospect);
  },
};
