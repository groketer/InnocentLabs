import { Sidebar } from "./Sidebar";
import { AgentStatusBadge } from "./AgentStatusBadge";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-ink-950">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex justify-end border-b border-ink-700 px-6 py-3">
          <AgentStatusBadge />
        </div>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
