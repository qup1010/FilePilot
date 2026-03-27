export interface IconWorkbenchModelConfig {
  base_url: string;
  api_key: string;
  model: string;
}

export interface IconWorkbenchConfig {
  text_model: IconWorkbenchModelConfig;
  image_model: IconWorkbenchModelConfig;
  image_size: string;
  concurrency_limit: number;
}

export interface IconTemplate {
  template_id: string;
  name: string;
  description: string;
  prompt_template: string;
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
  last_error?: string | null;
  updated_at: string;
}

export interface IconWorkbenchToolResult {
  tool_name: string;
  success: boolean;
  message: string;
  payload: Record<string, unknown>;
}

export interface IconWorkbenchPendingAction {
  action_id: string;
  action_type: string;
  title: string;
  description: string;
  requires_confirmation: boolean;
  requires_client: boolean;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface IconWorkbenchChatMessage {
  message_id: string;
  role: "assistant" | "user" | "system" | string;
  content: string;
  tool_results: IconWorkbenchToolResult[];
  action_ids: string[];
  created_at: string;
}

export interface IconWorkbenchSession {
  session_id: string;
  parent_dir: string;
  folders: FolderIconCandidate[];
  messages: IconWorkbenchChatMessage[];
  pending_actions: IconWorkbenchPendingAction[];
  chat_updated_at: string;
  created_at: string;
  updated_at: string;
  folder_count: number;
  ready_count: number;
}

export interface ApplyReadyTask {
  folder_id: string;
  folder_name: string;
  folder_path: string;
  image_path: string;
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

export interface IconWorkbenchClientExecution {
  command: "apply_ready_icons" | "restore_ready_icons" | string;
  action_type: string;
  tasks: ApplyReadyTask[] | RestoreReadyTask[];
  skipped_items: ApplyReadySkippedItem[];
}

export interface IconWorkbenchMessagePayload {
  content: string;
  selected_folder_ids?: string[];
  active_folder_id?: string | null;
}

export interface IconWorkbenchClientActionResult {
  folder_id?: string | null;
  folder_name?: string | null;
  folder_path?: string | null;
  status: string;
  message: string;
}

export interface IconWorkbenchClientActionReportPayload {
  action_type: string;
  results: IconWorkbenchClientActionResult[];
  skipped_items: IconWorkbenchClientActionResult[];
}

export interface IconWorkbenchActionResponse {
  session: IconWorkbenchSession;
  client_execution?: IconWorkbenchClientExecution;
}

export interface ApplyIconResult {
  folder_id?: string | null;
  folder_name?: string | null;
  folder_path: string;
  status: "applied" | "restored" | "failed" | string;
  message: string;
}
