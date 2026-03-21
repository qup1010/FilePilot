import { Suspense } from "react";
import WorkspaceClient from "@/components/workspace-client";

export default function WorkspacePage() {
  return (
    <Suspense fallback={
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="text-center space-y-4">
          <p className="text-on-surface-variant font-medium">加载工作台中...</p>
        </div>
      </div>
    }>
      <WorkspaceClient />
    </Suspense>
  );
}
