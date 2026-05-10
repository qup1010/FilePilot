import { Suspense } from "react";
import WorkspaceClient from "@/components/workspace-client";

export default function WorkspaceProgressPage() {
  return (
    <Suspense fallback={<WorkspaceLoading />}>
      <WorkspaceClient view="progress" />
    </Suspense>
  );
}

function WorkspaceLoading() {
  return (
    <div className="flex flex-1 items-center justify-center bg-surface">
      <p className="text-on-surface-variant font-medium">正在打开整理进度</p>
    </div>
  );
}
