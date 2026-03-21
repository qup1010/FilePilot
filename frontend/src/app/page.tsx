import { AppFrame } from "@/components/app-frame";
import { RuntimeStatus } from "@/components/runtime-status";
import { SessionLauncher } from "@/components/session-launcher";

export default function HomePage() {
  return (
    <AppFrame
      title="新建整理"
      subtitle="选择目标目录，让 AI 帮您一键规划与整理文件。"
    >
      <SessionLauncher />
      <RuntimeStatus />
    </AppFrame>
  );
}
