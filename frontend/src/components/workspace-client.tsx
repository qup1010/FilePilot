"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";

import { useSession } from "@/lib/use-session";
import type { PlanSnapshot, PrecheckSummary, ScannerProgress } from "@/types/session";

export function WorkspaceClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get("session_id");
  const [message, setMessage] = useState("");
  const {
    snapshot,
    journal,
    loading,
    error,
    sendMessage,
    scan,
    refreshPlan,
    runPrecheck,
    execute,
    rollback,
    cleanupEmptyDirs,
    abandonSession,
    openExplorer,
    loadJournal,
    activeAction,
    aiTyping,
    actionLog,
  } = useSession(sessionId);

  useEffect(() => {
    if (snapshot?.stage === "completed" && !journal) {
      void loadJournal();
    }
  }, [snapshot?.stage, journal, loadJournal]);

  if (!sessionId) {
    return (
      <section className="panel">
        <p className="muted">缺少 `session_id`，无工作台数据。</p>
        <div className="hero-actions" style={{ marginTop: 16 }}>
          <button className="primary-button" onClick={() => router.push("/")}>返回首页创建</button>
        </div>
      </section>
    );
  }

  const stage = snapshot?.stage ?? "idle";
  const isBusy = loading || stage === "scanning" || stage === "executing" || stage === "rolling_back";

  const STAGE_LABELS: Record<string, string> = {
    draft: "草稿",
    scanning: "深度扫描中",
    planning: "方案规划中",
    ready_for_precheck: "待预检",
    ready_to_execute: "待执行",
    executing: "正在执行",
    completed: "已完成",
    rolling_back: "正在回退",
    abandoned: "已放弃",
    stale: "已过期",
    interrupted: "已中断",
    idle: "就绪",
  };

  const sp: Partial<ScannerProgress> = snapshot?.scanner_progress || {};
  const scanner: ScannerProgress = {
    processed_count: sp.processed_count ?? 0,
    total_count: sp.total_count ?? 0,
    current_item: sp.current_item ?? null,
    recent_analysis_items: sp.recent_analysis_items ?? [],
  };

  const progressPercent =  scanner.total_count > 0 ? Math.min(100, Math.round((scanner.processed_count / scanner.total_count) * 100)) : 0;

  const ps: Partial<PlanSnapshot> = snapshot?.plan_snapshot || {};
  const plan: PlanSnapshot = {
    summary: ps.summary ?? "",
    items: ps.items ?? [],
    groups: ps.groups ?? [],
    unresolved_items: ps.unresolved_items ?? [],
    review_items: ps.review_items ?? [],
    invalidated_items: ps.invalidated_items ?? [],
    change_highlights: ps.change_highlights ?? [],
    stats: ps.stats ?? { directory_count: 0, move_count: 0, unresolved_count: 0 },
    readiness: ps.readiness ?? { can_precheck: false },
  };

  const precheck = snapshot?.precheck_summary as PrecheckSummary | null;

  async function handleSend() {
    if (!message.trim()) {
      return;
    }
    await sendMessage(message.trim());
    setMessage("");
  }

  return (
    <>
      <section className="panel">
        <div className="panel-title-row">
          <h2>
            {stage === "completed" ? "整理完成" : "工作台控制"}
          </h2>
          <div className="status-row">
            {(isBusy || activeAction) && <span className="loader-mini" />}
            <span className={`pill pill-${stage}`}>{loading ? "处理中..." : (STAGE_LABELS[stage] || stage)}</span>
            {sessionId && (
              <button 
                className="pill muted interactive-li" 
                style={{ marginLeft: 8, border: 'none', cursor: 'pointer' }}
                onClick={() => {
                  if (window.confirm("确定要放弃当前会话吗？未保存的操作将被丢弃。")) {
                    void abandonSession().then(() => router.push("/"));
                  }
                }}
              >
                ✕ 放弃并返回
              </button>
            )}
          </div>
        </div>

        {/* 引导 Banner */}
        {stage !== "completed" && stage !== "idle" && (
          <div className={`guidance-banner guidance-${stage}`}>
             {stage === "planning" || stage === "ready_for_precheck" ? (
               plan.unresolved_items.length > 0 ? (
                 <p>💡 <strong>发现待确认事项</strong>：请在下方对话框回复，或点击右侧事项快速补充信息。</p>
               ) : (
                 <p>💡 <strong>方案已就绪</strong>：请检查左侧移动项，无误后点击下方“运行执行预检”。</p>
               )
             ) : stage === "ready_to_execute" ? (
               <p>✅ <strong>预检通过</strong>：点击“确认执行”即可开始物理移动文件。如有疑虑可点击“重新预检”。</p>
             ) : stage === "scanning" ? (
               <p>🔍 <strong>正在深度分析</strong>：AI 正在识别文件用途，请稍等片刻...</p>
             ) : null}
          </div>
        )}

        {error ? <p className="error-text">{error}</p> : null}

        {(activeAction || aiTyping || actionLog.length > 0) && (
          <div className="action-feedback-box">
            {activeAction && (
              <p className="hint-text animate-pulse">💡 {activeAction}</p>
            )}
            {aiTyping && (
              <div className="ai-typing-preview">
                <span className="typing-label">AI 正在思考:</span>
                <p className="typing-content">{aiTyping}</p>
              </div>
            )}
            
            {actionLog.length > 0 && (
              <details className="ai-action-log" open={aiTyping !== ""}>
                <summary>
                  <span>AI 思考轨迹</span>
                  <span className="pill muted">{actionLog.length}</span>
                </summary>
                <div className="ai-action-log-content">
                  {[...actionLog].reverse().map(log => (
                    <div key={log.id} className="action-log-item">
                      <span className="action-log-time">{log.time}</span>
                      <span className={`action-log-msg ${log.important ? 'important' : ''}`}>
                        {log.message}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* 阶段 1：草稿/就绪 */}
        {(stage === "draft" || stage === "idle") && (
          <div className="hero-actions" style={{ marginTop: 24 }}>
            <button
              className="primary-button"
              onClick={() => void scan()}
              disabled={isBusy}
            >
              开始深度扫描
            </button>
          </div>
        )}

        {/* 阶段 2：扫描中 */}
        {stage === "scanning" && (
          <div className="subpanel" style={{ marginTop: 24 }}>
            <div className="panel-title-row">
              <h3>扫描进度与分析</h3>
              <span className="pill">{scanner.processed_count}/{scanner.total_count}</span>
            </div>
            <div className="progress-track" aria-label="scanner progress">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <p className="muted">当前项目: <span className="mono">{scanner.current_item ?? "无"}</span></p>
            <ul className="bullet-list">
              {scanner.recent_analysis_items.slice(0, 3).map((item) => (
                <li key={item.item_id}><strong>{item.display_name}</strong> - {item.suggested_purpose}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 阶段 3：方案规划中 */}
        {(stage === "planning" || stage === "ready_for_precheck") && (
          <>
            <div className="two-column" style={{ marginTop: 24 }}>
              <div className="subpanel">
                <div className="panel-title-row">
                  <h3>整理方案概览</h3>
                  <span className="pill">{plan.stats.move_count} 个移动项</span>
                </div>
                <p className="summary">{plan.summary || "方案已生成。"}</p>
                <ul className="bullet-list">
                  {plan.groups.map(g => (
                    <li key={g.directory} style={{ marginBottom: 8 }}>
                      <strong>{g.directory}</strong> - {g.count} 项
                      <ul className="bullet-list" style={{ marginTop: 6 }}>
                        {g.items.map(item => {
                          const analysis = scanner.recent_analysis_items.find(a => a.item_id === item.item_id);
                          return (
                            <li key={item.item_id} className="item-with-tooltip muted" style={{ display: 'inline-block', width: '100%', marginBottom: 4 }}>
                              ↳ {item.display_name}
                              {analysis && (
                                <div className="item-tooltip">
                                  <strong>建议用途:</strong> {analysis.suggested_purpose}<br/><br/>
                                  <strong>内容摘要:</strong> {analysis.summary}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="subpanel" style={{ opacity: isBusy ? 0.6 : 1, transition: "opacity 0.2s" }}>
                <div className="panel-title-row">
                  <h3>待确认事项</h3>
                  <span className="pill">{plan.unresolved_items.length}</span>
                </div>
                <ul className="bullet-list">
                  {plan.unresolved_items.map((item, idx) => {
                    const itemNameMatch = item.match(/^([^\s（(:]+)/);
                    const itemName = itemNameMatch ? itemNameMatch[1] : item;
                    return (
                      <li 
                        key={idx} 
                        className="warning-text interactive-li" 
                        onClick={() => {
                          const prefix = `关于 ${itemName}：`;
                          if (message.includes(prefix)) return;
                          setMessage(prev => prev ? `${prev}；${prefix}` : prefix);
                          document.querySelector('input')?.focus();
                        }}
                        title="点击快速回复"
                      >
                        ❓ {item}
                      </li>
                    );
                  })}
                  {plan.unresolved_items.length === 0 && <li className="muted">目前无待确认事项</li>}
                </ul>
                <div className="panel-title-row" style={{marginTop: 20}}>
                   <h3>异常状态</h3>
                   <span className="pill">{plan.review_items.length + plan.invalidated_items.length}</span>
                </div>
                <ul className="bullet-list">
                  {plan.review_items.map(item => <li key={item.item_id}>待复核: {item.display_name}</li>)}
                  {plan.invalidated_items.map(item => <li key={item.item_id}>已失效(目录文件结构已变): {item.display_name}</li>)}
                  {plan.review_items.length === 0 && plan.invalidated_items.length === 0 && <li className="muted">无异常状态条目</li>}
                </ul>
              </div>
            </div>

            <div className="input-section" style={{ marginTop: 24 }}>
              <label className="field">
                <span>对方案不满意？直接用自然语言告诉 AI 怎么调：</span>
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={isBusy}
                  placeholder="例如：把所有的发票文件单独放到 Docs/Bills 里"
                />
              </label>
              <div className="hero-actions" style={{ marginTop: 12 }}>
                <button
                  className="secondary-button"
                  onClick={() => void handleSend()}
                  disabled={isBusy || !message.trim()}
                >
                  提交调整
                </button>
              </div>
            </div>

            <div className="hero-actions" style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--panel-border)" }}>
              <button
                className="secondary-button"
                onClick={() => void refreshPlan()}
                disabled={isBusy}
              >
                刷新本地文件状态
              </button>
              <button
                className="primary-button"
                onClick={() => void runPrecheck()}
                disabled={isBusy}
              >
                运行执行预检
              </button>
            </div>
          </>
        )}

        {/* 阶段 4：待执行（预检完成） */}
        {stage === "ready_to_execute" && (
          <div style={{ marginTop: 24 }}>
            <div className="subpanel">
              <div className="panel-title-row">
                <h3>预检结果</h3>
                <span className="pill">{precheck?.can_execute ? "可安全执行" : "存在风险"}</span>
              </div>
              <ul className="bullet-list">
                {(precheck?.blocking_errors ?? []).map(err => <li key={err} style={{color: "var(--danger)"}}>阻断性错误: {err}</li>)}
                {(precheck?.warnings ?? []).map(warn => <li key={warn} style={{color: "var(--warning)"}}>提醒: {warn}</li>)}
                {precheck?.blocking_errors?.length === 0 && precheck?.warnings?.length === 0 && <li>各项检查均通过。</li>}
              </ul>
              {precheck?.move_preview && precheck.move_preview.length > 0 && (
                <>
                  <h4 style={{marginTop: 16}}>即将进行的移动 ({precheck.move_preview.length}):</h4>
                  <ul className="bullet-list" style={{maxHeight: 200, overflowY: "auto"}}>
                    {precheck.move_preview.slice(0, 10).map(item => (
                      <li key={`${item.source}-${item.target}`} className="muted">{item.source} -&gt; {item.target}</li>
                    ))}
                    {precheck.move_preview.length > 10 && <li className="muted">... 及其他 {precheck.move_preview.length - 10} 项</li>}
                  </ul>
                </>
              )}
            </div>

            <div className="hero-actions" style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--panel-border)" }}>
              <button
                className="secondary-button"
                onClick={() => void runPrecheck()}
                disabled={isBusy}
              >
                重新预检
              </button>
              <button
                className={precheck?.can_execute ? "primary-button" : "secondary-button"}
                onClick={() => void execute()}
                disabled={isBusy || !precheck?.can_execute}
              >
                确认执行
              </button>
            </div>
          </div>
        )}

        {/* 阶段 5：执行中 / 回退中 */}
        {(stage === "executing" || stage === "rolling_back") && (
          <div className="subpanel" style={{ marginTop: 24 }}>
            <div className="panel-title-row">
              <h3>{stage === "executing" ? "正在执行整理计划..." : "正在回退操作..."}</h3>
              <span className="loader-mini" />
            </div>
            <p className="muted">请勿关闭应用程序，这可能需要一点时间。</p>
          </div>
        )}

        {/* 阶段 6：完成 */}
        {stage === "completed" && (
          <div style={{ marginTop: 24 }}>
            {journal ? (
              <div className="subpanel">
                <div className="panel-title-row">
                  <h3>整理执行报告</h3>
                  <span className="pill">{journal.status === "completed" ? "全部成功" : journal.status === "partial_failure" ? "部分失败" : journal.status}</span>
                </div>
                <div className="metric-grid" style={{margin: "12px 0 0 0"}}>
                  <div className="metric-card">
                    <span className="metric-label">成功项</span>
                    <strong style={{color: "var(--success)"}}>{journal.success_count}</strong>
                  </div>
                  <div className="metric-card">
                    <span className="metric-label">失败项</span>
                    <strong style={{color: "var(--danger)"}}>{journal.failure_count}</strong>
                  </div>
                  <div className="metric-card">
                    <span className="metric-label">总计项</span>
                    <strong>{journal.item_count}</strong>
                  </div>
                </div>
              </div>
            ) : (
             <p className="muted">未找到日志数据 / 正在加载日志...</p>
            )}

            <div className="hero-actions" style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--panel-border)" }}>
              <button 
                className="secondary-button" 
                onClick={() => {
                  if (window.confirm("确定要回退本次操作吗？这会将所有已移动的文件尝试搬回原位。")) {
                    void rollback();
                  }
                }} 
                disabled={isBusy}
              >
                操作回退
              </button>
              <button className="secondary-button" onClick={() => void cleanupEmptyDirs()} disabled={isBusy}>
                清理空目录
              </button>
              {snapshot?.target_dir && (
                <button 
                  className="primary-button" 
                  onClick={() => void openExplorer(snapshot.target_dir)}
                  disabled={isBusy}
                >
                  📂 在文件夹中查看结果
                </button>
              )}
            </div>
          </div>
        )}

        {/* 异常阶段：已过期/中断/放弃 */}
        {(stage === "stale" || stage === "interrupted" || stage === "abandoned") && (
          <div className="subpanel" style={{ marginTop: 24 }}>
             <h3>会话已终止: {STAGE_LABELS[stage]}</h3>
             <p className="muted">该会话已不可用，您可以返回首页开启新的整理。</p>
             <div className="hero-actions" style={{ marginTop: 16 }}>
               <button className="primary-button" onClick={() => router.push("/")}>返回首页</button>
             </div>
          </div>
        )}

      </section>
    </>
  );
}
