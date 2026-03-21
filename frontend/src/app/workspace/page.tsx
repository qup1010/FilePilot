import { Suspense } from "react";

import { AppFrame } from "@/components/app-frame";
import { WorkspaceClient } from "@/components/workspace-client";

export default function WorkspacePage() {
  return (
    <AppFrame
      title="Workspace"
      subtitle="这里会承接扫描进度、待确认项、计划分组、自然语言输入和本轮变化。"
    >
      <Suspense fallback={<section className="panel"><p className="muted">Loading workspace…</p></section>}>
        <WorkspaceClient />
      </Suspense>
    </AppFrame>
  );
}
