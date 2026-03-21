import { RuntimeStatus } from "@/components/runtime-status";
import { SessionLauncher } from "@/components/session-launcher";

export default function HomePage() {
  return (
    <div className="flex-1 overflow-y-auto bg-surface p-8 max-w-4xl mx-auto w-full pt-16">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-extrabold font-headline mb-3 text-on-surface">新建整理会话</h1>
        <p className="text-on-surface-variant max-w-lg mx-auto leading-relaxed">
          选择一个本地目录，AI 将自动扫描其中的文件结构，并提供智能的整理、归档方案。
        </p>
      </div>

      <div className="space-y-6">
        <SessionLauncher />
        <RuntimeStatus />
      </div>
    </div>
  );
}
