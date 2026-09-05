"use client";

import { useEffect, useState } from "react";
import type { AppSettings } from "@/lib/models/settings";

interface InfraStatus {
  openai_api_key_configured: boolean;
  database_configured: boolean;
  cron_secret_configured: boolean;
  smtp: {
    configured: boolean;
    host: string | null;
    port: string | null;
    from_name: string | null;
    sender_postal_address: string | null;
  };
}

function StatusPill({ ok }: { ok: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        ok
          ? "bg-emerald-500/10 text-emerald-300"
          : "bg-white/5 text-white/40"
      }`}
    >
      {ok ? "Configured" : "Not configured"}
    </span>
  );
}

export function SettingsContent() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [infra, setInfra] = useState<InfraStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load settings.");
      setSettings(data.settings);
      setInfra(data.infra);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load settings.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not save settings.");
      setSettings(data.settings);
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings || !infra) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <h1 className="text-lg font-semibold text-white">Settings</h1>
        {error ? (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : (
          <p className="mt-4 text-sm text-white/40">Loading…</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <h1 className="text-lg font-semibold text-white">Settings</h1>
      <p className="mt-1 text-xs text-white/40">
        Sending pace and follow-up behavior for outreach campaigns.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 rounded-md border border-ink-700 bg-ink-900 p-5">
        <h2 className="text-sm font-semibold text-white">Follow-up behavior</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs text-white/50">Max follow-ups</span>
            <input
              type="number"
              min={0}
              max={10}
              value={settings.max_follow_ups}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  max_follow_ups: Number(e.target.value),
                })
              }
              className="mt-1 w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
            />
          </label>

          <label className="block">
            <span className="text-xs text-white/50">Days between follow-ups</span>
            <input
              type="number"
              min={1}
              max={30}
              value={settings.min_days_between_follow_ups}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  min_days_between_follow_ups: Number(e.target.value),
                })
              }
              className="mt-1 w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
            />
          </label>

          <label className="block">
            <span className="text-xs text-white/50">Daily send limit</span>
            <input
              type="number"
              min={1}
              max={2000}
              value={settings.daily_send_limit}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  daily_send_limit: Number(e.target.value),
                })
              }
              className="mt-1 w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
            />
          </label>
        </div>

        <label className="mt-4 flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.require_manual_approval}
            onChange={(e) =>
              setSettings({
                ...settings,
                require_manual_approval: e.target.checked,
              })
            }
            className="h-4 w-4 rounded border-ink-600 bg-ink-800"
          />
          <span className="text-sm text-white/70">
            Require my approval before the first email in any sequence sends
          </span>
        </label>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && (
            <span className="text-xs text-emerald-400">Saved.</span>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-md border border-ink-700 bg-ink-900 p-5">
        <h2 className="text-sm font-semibold text-white">Infrastructure</h2>
        <p className="mt-1 text-xs text-white/40">
          Managed in Vercel&apos;s environment variables, not here — shown for
          visibility only. Nothing below is a secret value.
        </p>

        <div className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-white/70">OpenAI API key</span>
            <StatusPill ok={infra.openai_api_key_configured} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/70">Database</span>
            <StatusPill ok={infra.database_configured} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/70">Cron authentication</span>
            <StatusPill ok={infra.cron_secret_configured} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/70">SMTP (outbound email)</span>
            <StatusPill ok={infra.smtp.configured} />
          </div>

          {infra.smtp.configured && (
            <div className="ml-4 space-y-1 border-l border-ink-700 pl-4 text-xs text-white/40">
              {infra.smtp.host && <p>Host: {infra.smtp.host}</p>}
              {infra.smtp.from_name && <p>From name: {infra.smtp.from_name}</p>}
              {infra.smtp.sender_postal_address ? (
                <p>Sender address: {infra.smtp.sender_postal_address}</p>
              ) : (
                <p className="text-amber-400">
                  No SENDER_POSTAL_ADDRESS set — required in every commercial
                  email under CAN-SPAM. Add it in Vercel before sending any
                  campaigns.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
