/**
 * MILESTONE 3L — improvement #3: escalation notifications.
 *
 * Sends a plain internal notification to Innocent's own inbox(es) —
 * reuses BCC_NOTIFICATION_EMAILS since those are already his personal
 * addresses, configured earlier for exactly this kind of "keep me in the
 * loop" purpose.
 *
 * Deliberately separate from sendEmail.ts: that function is for
 * prospect-facing commercial email and unconditionally applies the
 * CAN-SPAM compliance footer (postal address, unsubscribe link) — neither
 * of which makes sense for an internal alert to the business owner
 * himself. Reuses the same SMTP transport, just without that machinery.
 */

import nodemailer from "nodemailer";

let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }
  return cachedTransporter;
}

function notificationRecipients(): string[] {
  const raw = process.env.BCC_NOTIFICATION_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((addr) => addr.trim())
    .filter(Boolean);
}

export async function notifyOwner(subject: string, body: string): Promise<void> {
  const recipients = notificationRecipients();

  if (recipients.length === 0) {
    // No BCC_NOTIFICATION_EMAILS configured — nowhere to send this.
    // Not an error; just means this feature has nothing to do yet.
    return;
  }

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    return;
  }

  const fromName = process.env.SMTP_FROM_NAME?.trim() || "Innocent Labs";

  try {
    await getTransporter().sendMail({
      from: `"${fromName}" <${process.env.SMTP_USER}>`,
      to: recipients,
      subject: `[Innocent Intelligence] ${subject}`,
      text: body,
    });
  } catch (error) {
    // A failed notification should never break whatever triggered it.
    console.error("[notifyOwner] Could not send notification:", error);
  }
}
