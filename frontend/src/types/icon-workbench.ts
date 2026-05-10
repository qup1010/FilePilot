export interface IconWorkbenchModelConfig {
  base_url: string;
  model: string;
  secret_state?: "empty" | "stored";
  configured?: boolean;
  name?: string;
}

export interface IconWorkbenchConfig {
  name?: string;
  text_model: IconWorkbenchModelConfig;
  image_model: IconWorkbenchModelConfig;
  image_size: string;
  analysis_concurrency_limit: number;
  image_concurrency_limit: number;
  save_mode: "in_folder" | "centralized";
}

export interface IconWorkbenchConfigPayload {
  config: IconWorkbenchConfig;
  presets: Array<{ id: string; name: string }>;
  active_preset_id: string;
}

export interface IconTemplate {
  template_id: string;
  name: string;
  description: string;
  prompt_template: string;
  cover_image?: string | null;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

export interface IconAnalysisResult {
  category: string;
  visual_subject: string;
  summary: string;
  suggested_prompt: string;
  analyzed_at: string;
}

export interface IconPreviewVersion {
  version_id: string;
  version_number: number;
  prompt: string;
  image_path: string;
  image_url: string;
  status: "ready" | "error" | string;
  error_message?: string | null;
  created_at: string;
}

export interface FolderIconCandidate {
  folder_id: string;
  folder_path: string;
  folder_name: string;
  analysis_status: "idle" | "ready" | "error" | string;
  analysis: IconAnalysisResult | null;
  current_prompt: string;
  prompt_customized: boolean;
  versions: IconPreviewVersion[];
  current_version_id: string | null;
  applied_version_id: string | null;
  applied_at: string | null;
  last_error?: string | null;
  updated_at: string;
}

export interface IconWorkbenchClientActionSummary {
  action_type: string;
  summary: {
    success_count: number;
    failed_count: number;
    skipped_count: number;
    message: string;
  };
  results: Record<string, unknown>[];
  updated_at: string;
}

export interface IconWorkbenchSession {
  session_id: string;
  target_paths: string[];
  folders: FolderIconCandidate[];
  last_client_action?: IconWorkbenchClientActionSummary | null;
  created_at: string;
  updated_at: string;
  folder_count: number;
  ready_count: number;
}

export interface IconWorkbenchHistoryItem {
  session_id: string;
  created_at: string;
  updated_at: string;
  target_count: number;
  folder_count: number;
  ready_count: number;
  applied_count: number;
  error_count: number;
  target_paths: string[];
  last_action_type?: string | null;
  last_action_message?: string | null;
  last_action_at?: string | null;
}

export interface IconWorkbenchProgressPayload {
  stage: "analyzing" | "applying_template" | "generating" | string;
  totalFolders: number;
  completedFolders: number;
  currentFolderId: string | null;
  currentFolderName: string | null;
}

export interface IconWorkbenchEvent {
  event_type: string;
  session_id: string;
  session_snapshot?: IconWorkbenchSession;
  progress?: IconWorkbenchProgressPayload;
  folder_id?: string | null;
  version_id?: string | null;
  status?: string | null;
}

export interface IconWorkbenchTargetUpdatePayload {
  target_paths: string[];
  mode?: "append" | "replace";
}

export interface ApplyReadyTask {
  folder_id: string;
  folder_name: string;
  folder_path: string;
  version_id: string;
  image_path: string;
  save_mode: "in_folder" | "centralized";
}

export interface RestoreReadyTask {
  folder_id?: string | null;
  folder_name?: string | null;
  folder_path: string;
}

export interface ApplyReadySkippedItem {
  folder_id: string;
  folder_name: string;
  status: string;
  message: string;
}

export interface ApplyReadyPreparation {
  session_id: string;
  total: number;
  ready_count: number;
  skipped_count: number;
  tasks: ApplyReadyTask[];
  skipped_items: ApplyReadySkippedItem[];
}

export interface IconWorkbenchClientActionResult {
  folder_id?: string | null;
  folder_name?: string | null;
  folder_path?: string | null;
  version_id?: string | null;
  status: string;
  message: string;
}

export interface IconWorkbenchClientActionReportPayload {
  action_type: string;
  results: IconWorkbenchClientActionResult[];
  skipped_items: IconWorkbenchClientActionResult[];
}

export interface ApplyIconResult {
  folder_id?: string | null;
  folder_name?: string | null;
  folder_path: string;
  version_id?: string | null;
  status: "applied" | "restored" | "failed" | string;
  message: string;
}

export interface BackgroundRemovalBatchProgress {
  total: number;
  completed: number;
  success: number;
  failed: number;
  activeFolderNames: string[];
}
