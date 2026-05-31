# FilePilot 架构优化路线图

更新日期：2026-05-31

进度状态：P0 ID 稳定性已完成；P1 状态阶段规则已完成第一阶段收束；P2 Review 语义已完成常量化起步。

## 目的

这份文档把两份外部问题清单合并成一份可执行的项目优化路线图。它不把所有代码味道都当成紧急缺陷，也不建议一次性大重构；目标是在不打断当前主链路的前提下，逐步稳定会话、ID、规划和执行之间的契约。

当前主链路仍以“扫描来源 -> 生成规划 -> 用户调整 -> 预检 -> 确认执行 -> 记录与回退”为核心。优化工作应优先保护这条链路。

## 当前事实校准

外部清单中的总体方向有参考价值，但部分描述基于旧路径或泛化判断。当前仓库实际情况如下：

- 代码包名是 `file_pilot`，不是 `file_organizer`。
- `OrganizerSessionService` 仍然约 3500 行，是核心门面和大量 helper 的集中点。
- 项目已经有局部拆分：`session_store.py`、`snapshot_builder.py`、`scan_workflow_service.py`、`planning_conversation_service.py`、`execution_app_service.py`、`source_manager.py`、`target_manager.py`、`task_planner_adapter.py` 等。
- 这些拆分还没有完全形成稳定边界，多个模块仍反向依赖 `OrganizerSessionService` 的私有 helper。
- `OrganizerSession` 同时保存旧字段和新字段，例如 `scan_lines`、`planner_items`、`pending_plan`、`plan_snapshot`、`task_state`、`conversation_state`、`execution_state`。这部分是兼容历史会话的现实成本，但也提高了数据流复杂度。
- `Review` 是产品语义上的特殊落点，当前已先通过集中常量收束目录名、slot id 和展示名；后续仍可继续演进为显式 target kind。

## 优化原则

1. 先稳定契约，再移动代码。
2. 每次只改一个领域边界：ID、状态、快照、规划或执行，不混在一个大 PR 中。
3. 保持旧会话可读，新增字段必须有迁移或派生策略。
4. Python 服务、前端类型和 API 快照必须一起考虑。
5. 优先写回归测试锁住行为，再拆实现。
6. 不为了减少行数而拆类；只有当新边界能减少状态分叉、减少动态推导或降低测试成本时才拆。

## 优先级总览

| 优先级 | 主题 | 真实问题 | 目标 |
| --- | --- | --- | --- |
| P0 | ID 稳定性 | ID 在部分路径下依赖动态推导，恢复、增量、兼容路径存在漂移风险 | 会话生命周期内 source/target ID 稳定、可恢复 |
| P1 | 手动干预可撤销 | 手动覆盖有 diff 记录，但缺少单项恢复 AI 建议的显式数据和操作 | 支持恢复单项 AI 原建议 |
| P1 | 状态转换收束 | `stage` 字符串赋值分散，规则难以审计 | 集中定义阶段、锁定态、终止态和合法转换 |
| P2 | TargetSlot 管理统一 | 初始整理、增量整理、新建目录、Review 的槽来源分散 | 建立统一 slot 读取/分配接口 |
| P2 | Review 语义显式化 | `Review` 作为字符串在多处硬编码 | 将 Review 从普通目录字符串提升为显式领域概念 |
| P2 | 同名目标冲突体验 | 预检能拦截冲突，但用户需要手动处理 | 提供自动建议或批量修正策略 |
| P3 | 扫描数据双轨收敛 | `scan_lines` 和 `planner_items` 并存增加复杂度 | 完成兼容迁移后，让结构化数据成为主路径 |
| P3 | 服务层继续削薄 | 现有拆分仍依赖主服务 helper | 逐步让新模块拥有明确输入输出 |

## 当前实施进度

### 已完成

- **P0：ID 稳定性**
  - 新增可持久化的 `IdRegistryState`，随 `OrganizerSession` 序列化和反序列化。
  - `IdRegistry` 支持从 state 恢复和导出 state。
  - `_build_id_registry()` 优先使用持久化 registry state；旧会话缺失 state 时可从现有会话数据派生并回写。
  - source relpath 与 target real path 的 ID 分配改为稳定追加，避免恢复、增量或新建目录时重排旧 ID。
  - 规划任务构建时会把 sources、targets、mappings 对齐到稳定 registry ID，避免旧 slot/source id 与新 registry 不一致。
  - 已补充 ID registry/session payload 回归测试。

- **P1：状态阶段规则第一阶段收束**
  - 新增 `file_pilot/app/session_constants.py`，集中定义 session stage、stage set、task phase 与标准阶段冲突错误码。
  - 新增轻量 helper：`normalize_stage()`、`is_stage()`、`is_stage_in()`、`is_locked_stage()`、`is_terminal_stage()`、`is_planning_mutable_stage()`、`is_recovery_stage()`、`is_reclaimable_lock_stage()`、`ensure_stage()`、`ensure_stage_in()`。
  - 已替换 session、scan、planning、execution、history、lifecycle、orchestrator、store 等核心路径中的主要裸阶段字符串和直接 set membership 判断。
  - 暂不引入严格状态机，保留现有行为和异常语义，降低回归风险。
  - 已补充 `tests/test_session_constants.py` 覆盖阶段规范化、谓词和 ensure helper。

- **P2：Review 语义显式化起步**
  - 已集中 `REVIEW_SLOT_ID`、`REVIEW_DIR_NAME`、`REVIEW_DISPLAY_NAME`。
  - 已替换 target resolver、task planner adapter、snapshot builder、execution app 等核心路径中的 Review 硬编码。
  - 当前仍保持用户可见行为不变；后续可继续增加 `kind: "review"` 或 `is_review` 等显式 payload 字段。

### 最近验证

已运行聚焦回归测试：

```powershell
py -3 -m unittest tests.test_session_constants tests.test_session_models tests.test_session_service tests.test_scan_workflow_service tests.test_execution_app_service tests.test_session_lifecycle_service tests.test_history_app_service tests.test_planning_conversation_service -v
```

结果：通过。

已检查相关变更文件 lint 诊断：无新增诊断。

### 下一步建议

1. 继续完成 **P1：状态阶段规则** 的第二阶段：评估是否移除 `OrganizerSessionService` 中兼容保留的 `_TERMINAL_STAGES`、`_LOCKED_STAGES`、`_PLANNING_MUTABLE_STAGES`、`_RECOVERY_STAGES` 类属性别名，并补充关键状态转换测试。
2. 推进 **P1：支持手动干预撤销**，为单项 mapping 保存 AI 原始建议并提供恢复入口。
3. 在 P2 中继续把 Review 从常量语义推进到 payload 显式语义，再统一 TargetSlot 读取/创建接口。

## P0：稳定 ID 契约

状态：已完成第一轮实现与回归测试。

### 问题

当前 `IdRegistry` 本身不是简单的 `enumerate` 映射，但 ID 仍有几类风险：

- source ID 主要来自 `planner_items.planner_id`；当没有 `planner_items` 时会从 `scan_lines` 顺序生成 `F001`、`F002`。
- target slot 在初始模式可来自 `task_state` 或 `plan_snapshot`，在增量模式会从目录树重新生成。
- `task_state.mappings` 依赖 `source_ref_id` 和 `target_slot_id`，一旦恢复路径重新分配 ID，历史映射就可能失真。

### 目标

- 同一会话中，同一 source relpath 始终得到同一个 source id。
- 同一会话中，同一 target real path 始终得到同一个 target slot id。
- 新增 source/target 只追加新 ID，不重排旧 ID。
- 旧会话没有 registry snapshot 时，第一次加载可以从现有 `planner_items`、`task_state`、`plan_snapshot` 派生并保存。

### 建议设计

在 `OrganizerSession` 中增加轻量持久化结构，例如：

```python
@dataclass
class IdRegistryState:
    source_ids_by_relpath: dict[str, str] = field(default_factory=dict)
    target_ids_by_real_path: dict[str, str] = field(default_factory=dict)
    next_source_number: int = 1
    next_target_number: int = 1
```

命名不必固定为这个，但需要满足三个要求：可序列化、可迁移、可幂等分配。

### 实施步骤

1. 为 `IdRegistry` 增加 `to_state()`、`from_state()` 或等价方法。
2. 给 `OrganizerSession` 增加 `id_registry_state` 字段，`from_dict()` 对旧数据默认置空。
3. 在 `_build_id_registry()` 中优先使用持久化 state；缺失时从现有会话数据派生。
4. 扫描完成、规划应用、目标槽新增后保存最新 registry state。
5. 补测试覆盖：

- 恢复会话后 source ID 不变。
- 增量新增文件不会改变旧文件 ID。
- 新建目录追加 slot，不改变旧 slot。
- 旧格式会话能正常派生并保存 registry state。

### 验证范围

- `tests/test_session_service.py`
- `tests/test_domain_architecture.py`
- `tests/test_task_planner_adapter.py`
- 涉及 API 快照时同步检查 `frontend/src/types/session.ts`

## P1：支持手动干预撤销

### 问题

当前手动调整会设置 `user_overridden=True`，并通过 `last_ai_pending_plan` 与手动同步 diff 留痕。但单个 `MappingEntry` 没有记录 AI 原始建议，因此用户无法对单项执行“恢复 AI 建议”。

### 目标

- 用户手动调整某项时，保留调整前的 AI 建议。
- 用户可以把某个 item 恢复到 AI 原建议。
- 恢复操作不需要重新请求模型。

### 建议设计

扩展 `MappingEntry` 或在 app 层 payload 中增加：

```python
original_target_slot_id: str | None = None
original_status: str | None = None
overridden_at: str | None = None
```

如果不想污染 domain model，也可以放在 app 层手动覆盖表中，但必须能随 session 持久化。

### 实施步骤

1. 在 `TaskPlannerAdapter.assign_mapping()` 中，如果旧 mapping 不是用户覆盖，先保存旧 `target_slot_id/status` 作为 original。
2. 如果旧 mapping 已经是用户覆盖，保留第一次覆盖前的 original，不被后续覆盖刷新。
3. 增加 service 方法，例如 `restore_ai_mapping(session_id, item_id)`。
4. API 与前端增加对应操作入口。
5. 快照中暴露 `can_restore_ai_suggestion` 或等价字段，避免前端猜测。

### 验证范围

- `tests/test_task_planner_adapter.py`
- `tests/test_planning_conversation_service.py`
- `tests/test_api_sessions.py`
- 前端类型检查 `npm run typecheck`

## P1：集中状态阶段规则

状态：第一阶段已完成。阶段名、阶段集合、Review 常量、task phase 和轻量校验 helper 已集中到 `file_pilot/app/session_constants.py`；核心服务路径已完成主要替换。严格状态机暂未引入。

### 问题

`stage` 仍是字符串，并且赋值分布在 session、scan、planning、execution、history 等模块。已有 `_LOCKED_STAGES`、`_TERMINAL_STAGES` 等基本约束，但合法转换关系不集中。

### 目标

- 所有阶段名集中定义。
- 锁定态、终止态、可恢复态集中定义。
- 关键状态转换通过统一 helper 执行。
- 第一阶段不强求替换所有字符串，只先防止新增分散规则。

### 建议设计

已新增 `file_pilot/app/session_constants.py`：

```python
STAGE_DRAFT = "draft"
STAGE_SCANNING = "scanning"
STAGE_PLANNING = "planning"
STAGE_READY_FOR_PRECHECK = "ready_for_precheck"
STAGE_READY_TO_EXECUTE = "ready_to_execute"
STAGE_EXECUTING = "executing"
STAGE_COMPLETED = "completed"

LOCKED_STAGES = {STAGE_SCANNING, STAGE_EXECUTING, "rolling_back"}
TERMINAL_STAGES = {STAGE_COMPLETED, "abandoned", "stale"}
```

后续可再演进为 `SessionStateMachine.transition(session, to_stage)`。

### 实施步骤

1. 先抽常量，不改变行为。
2. 替换服务端核心路径中的裸字符串。
3. 增加状态规则测试，覆盖启动、扫描完成、规划、预检、执行、回退、中断、废弃。
4. 再决定是否引入严格状态机；不要第一步就大规模替换。

## P2：统一 TargetSlot 管理

### 问题

target slot 来源较多：

- 初始整理：`task_state.targets` 或 `plan_snapshot.target_slots`。
- 增量整理：从 `incremental_selection.target_directory_tree` 动态构建。
- 新目录：在 plan 或手动调整中被动 `_ensure_target_slot()`。
- Review：特殊字符串，不进入普通 slot 流程。

功能大体正确，但维护成本高，且容易出现 display name、real path、slot id 不一致。

### 目标

- 所有 target slot 的读取、创建、查找、序列化经过一个接口。
- 新建目录、既有目录、Review 有清晰语义。
- 改名或移动目录时，相关 slot 的展示信息和 real path 同步更新。

### 建议步骤

1. 先把 `_target_slots_from_session()`、`_ensure_target_slot()` 周围行为补测试。
2. 新增 `TargetSlotRegistry` 或扩展现有 `target_manager`，先只做薄封装。
3. 将初始/增量两种 slot 来源统一成同一个返回 payload。
4. 再处理目录改名时的 slot 更新。

## P2：显式化 Review 语义

状态：已完成常量化起步，尚未增加显式 target kind/payload 字段。

### 问题

`Review` 当前既像目录名，又像 slot id，又是产品里的待确认区。硬编码可以工作，但会限制未来：

- 无法自然支持自定义显示名。
- 无法支持 Review 子目录。
- 容易和用户真实目录名混淆。

### 目标

- 内部语义上把 Review 当成特殊 target kind，而不是普通字符串。
- 保持现有产品规则：Review 默认跟随 `new_directory_root/Review`，当前版本不支持 Review 子目录。

### 建议步骤

1. 定义常量 `REVIEW_SLOT_ID = "Review"`、`REVIEW_DIR_NAME = "Review"`、`REVIEW_DISPLAY_NAME = "待确认区"`，先消除散落字符串。（已完成）
2. 给 target payload 增加可选字段，例如 `kind: "directory" | "review"` 或 `is_review: bool`。
3. API 与前端先兼容旧字段，再逐步使用新字段。
4. 不在这一阶段改变用户可见行为。

## P2：改善同名目标冲突体验

### 问题

`validate_final_plan()` 能检测多个来源指向同一目标路径，因此不会静默覆盖。但用户体验仍不好：冲突发生后需要人工逐个改名或重排。

### 目标

- 预检发现冲突时，给出可自动应用的重命名建议。
- 用户可以接受建议后重新预检。

### 可选方案

1. 保守方案：只在 UI 展示建议，不自动改 plan。
2. 半自动方案：提供“为冲突项追加序号”的按钮。
3. 自动方案：在 `_target_relpath_for_source()` 中直接分配唯一文件名。

建议先采用半自动方案，因为自动改名会改变用户预期，也可能影响回退和日志可读性。

## P3：扫描数据双轨收敛

### 问题

`scan_lines` 是旧文本格式，`planner_items` 是结构化格式。双轨存在兼容价值，但也带来重复解析和 fallback 分支。

### 目标

- 新会话以结构化 `planner_items` / `task_state.sources` 为主。
- 旧会话加载时迁移或派生结构化数据。
- `scan_lines` 最终只作为展示或兼容字段。

### 建议步骤

1. 统计当前测试和 API 仍依赖 `scan_lines` 的位置。
2. 确认 `planner_items` 覆盖所有前端需要的字段。
3. 增加旧会话迁移测试。
4. 逐步减少从 `scan_lines` 解析 source 的核心路径。

## P3：继续削薄 SessionService

### 问题

现有模块已拆出一部分职责，但 `OrganizerSessionService` 仍承担门面、兼容、helper、状态管理、快照桥接等多重角色。

### 目标

- `OrganizerSessionService` 逐步变成薄门面。
- 新模块不再依赖主服务大量私有方法。
- 每个模块拥有明确输入输出，便于单元测试。

### 建议顺序

1. 先抽状态常量和 ID registry state，因为它们是其他拆分的基础。
2. 再让 `SnapshotBuilder` 依赖显式 context，而不是整个 `OrganizerSessionService`。
3. 再收束 `TaskPlannerAdapter` 与 target slot 管理。
4. 最后考虑把扫描、规划、执行编排彻底拆成独立 orchestrator。

## 不建议现在做的事

- 不建议一次性重写 `OrganizerSession` 数据模型。它承载了历史会话兼容，硬切风险高。
- 不建议马上删除 `scan_lines`。先完成结构化迁移与测试覆盖。
- 不建议把所有 `stage` 立即替换成严格 Enum。前端、API 和持久化 JSON 都依赖字符串，先集中常量更稳。
- 不建议自动把所有同名冲突静默重命名。先让用户可见、可确认。
- 不建议把 Review 子目录作为本轮目标。当前产品规则明确“不支持 Review 子目录”。

## 最小执行计划

### 第 1 步：ID 稳定性回归测试

状态：已完成。

先写测试，不改大结构：

- 会话恢复后 `planner_items` 的 source id 保持不变。
- 只有 `scan_lines` 的旧会话派生 ID 后保存，下次加载不漂移。
- 新增 target slot 不改变旧 slot id。

### 第 2 步：持久化 registry state

状态：已完成。

在不改变 API 快照结构的情况下，给 session JSON 增加 registry state，并在 `_build_id_registry()` 中优先使用它。

### 第 3 步：手动恢复 AI 建议

给 `MappingEntry` 或 app 层 mapping payload 增加 original 字段，增加 service/API/前端入口。

### 第 4 步：状态常量集中

状态：第一阶段已完成。实际落地文件为 `file_pilot/app/session_constants.py`，并已补轻量 helper 与回归测试。

新增 `session_stages.py`，替换核心服务端路径里的裸字符串，并补状态规则测试。

### 第 5 步：Review 和 TargetSlot 收束

状态：Review 常量化已完成；TargetSlot 统一管理仍待推进。

先常量化 Review，再统一 target slot 读取与创建接口。

## 提交前验证建议

按改动范围运行：

```powershell
python -m unittest tests.test_session_service tests.test_domain_architecture tests.test_task_planner_adapter -v
python -m unittest tests.test_api_sessions tests.test_planning_conversation_service -v
Set-Location frontend
npm run typecheck
```

如果改动 execution 或 precheck，再补：

```powershell
python -m unittest tests.test_execution_app_service tests.test_execution_service -v
```

## 成功标准

- 旧会话可以读取，新会话可以保存新增字段。
- 用户手动调整后的映射不会因为恢复会话、增量新增或快照重建而错位。
- 前端看到的 `session_snapshot` 字段保持兼容。
- 状态转换规则能通过测试审计，不再依赖散落字符串判断。
- `OrganizerSessionService` 行数是否下降不是第一指标；更重要的是核心契约更稳定、测试更容易写。
