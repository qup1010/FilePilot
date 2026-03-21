export type View = 'workbench' | 'history' | 'settings';

export interface FileItem {
  id: string;
  name: string;
  type: 'document' | 'image' | 'archive';
  description: string;
  suggestedDestinations: string[];
}

export interface Cluster {
  id: string;
  name: string;
  icon: string;
  fileCount: number;
  isNew?: boolean;
}

export interface Session {
  id: string;
  title: string;
  date: string;
  target: string;
  fileCount: number;
  status: 'stable' | 'most-recent';
}

export interface MovePreviewItem {
  fileName: string;
  currentLocation: string;
  restoredLocation: string;
  status?: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
}
