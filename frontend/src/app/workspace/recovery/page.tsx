import { Suspense } from "react";
import WorkspaceClient from "@/components/workspace-client";

export default function WorkspaceRecoveryPage() {
  return (
    <Suspense fallback={<WorkspaceLoading />}>
      <WorkspaceClient view="recovery" />
    </Suspense>
  );
}

function WorkspaceLoading() {
  return (
    <div className="flex flex-1 items-center justify-center bg-surface">
      <p className="text-on-surface-variant font-medium">正在打开恢复页</p>
    </div>
  );
}
