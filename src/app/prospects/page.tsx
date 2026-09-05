import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { ProspectsContent } from "@/components/ProspectsContent";

export default function ProspectsPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <ProspectsContent />
      </Suspense>
    </AppShell>
  );
}
