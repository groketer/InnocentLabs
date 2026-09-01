import { AppShell } from "@/components/AppShell";
import { TaskDetailContent } from "@/components/TaskDetailContent";

export default function TaskDetailPage({ params }: { params: { id: string } }) {
  return (
    <AppShell>
      <TaskDetailContent taskId={params.id} />
    </AppShell>
  );
}
