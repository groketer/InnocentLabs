import {
  getProspectByUnsubscribeToken,
  updateProspectSequence,
} from "@/lib/models/prospects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  params,
}: {
  params: { token: string };
}) {
  const prospect = await getProspectByUnsubscribeToken(params.token);

  if (!prospect) {
    return (
      <Shell>
        <p>This unsubscribe link isn&apos;t valid, or has already been used.</p>
      </Shell>
    );
  }

  if (prospect.sequence_status !== "unsubscribed") {
    await updateProspectSequence(prospect.user_id, prospect.id, {
      sequence_status: "unsubscribed",
      next_send_at: null,
    });
  }

  return (
    <Shell>
      <p>You&apos;ve been unsubscribed and won&apos;t receive further emails from us.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-8 text-center text-white/80">
      <div className="max-w-md">{children}</div>
    </div>
  );
}
