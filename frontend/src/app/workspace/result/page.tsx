import { Suspense } from "react";
import WorkspaceClient from "@/components/workspace-client";

export default function WorkspaceResultPage() {
  return (
    <Suspense fallback={<WorkspaceLoading />}>
      <WorkspaceClient view="result" />
    </Suspense>
  );
}

function WorkspaceLoading() {
  return (
    <div className="flex flex-1 items-center justify-center bg-surface">
      <p className="text-on-surface-variant font-medium">正在打开整理结果</p>
    </div>
  );
}
