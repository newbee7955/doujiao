/**
 * 豆角工具箱插件系统标准契约与类型定义 (V2.0)
 */

export type CapabilityType =
  | 'network.request'
  | 'download.enqueue'
  | 'browser.login'
  | 'browser.extract'
  | 'media.merge'
  | 'clipboard.history'
  | 'samba.client'
  | 'ui.dialog';

export interface NetworkCapability {
  capability: 'network.request';
  hosts: string[];
  methods?: ('GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD')[];
}

export interface DownloadCapability {
  capability: 'download.enqueue';
  formats?: string[];
}

export interface BrowserLoginCapability {
  capability: 'browser.login';
  domain: string;
}

export interface MediaMergeCapability {
  capability: 'media.merge';
}

export interface ClipboardCapability {
  capability: 'clipboard.history';
}

export interface SambaCapability {
  capability: 'samba.client';
}

export type PluginCapability =
  | NetworkCapability
  | DownloadCapability
  | BrowserLoginCapability
  | MediaMergeCapability
  | ClipboardCapability
  | SambaCapability
  | { capability: CapabilityType; [key: string]: any };

export interface SambaConfig {
  host: string;
  port?: number;
  share: string;
  basePath?: string;
  username?: string;
  password?: string;
  domain?: string;
  workgroup?: string;
}

export interface SambaProfile {
  id: string;
  name: string;
  config: SambaConfig;
  createdAt: number;
  lastConnected?: number;
}

export interface SambaFileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
  birthtime?: number;
  extension: string;
}

export interface SambaTransferProgress {
  id: string;
  type: 'upload' | 'download';
  fileName: string;
  transferredBytes: number;
  totalBytes: number;
  progress: number;
  speed: string;
  status: 'transferring' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

export interface PluginEngines {
  doujiao: string;    // e.g. ">=0.2.0 <0.3.0"
  pluginApi: string;  // e.g. "^1.0.0"
}

export interface PluginEntrypoints {
  ui: string;         // e.g. "dist/index.html"
}

export interface PluginManifest {
  $schema?: string;
  id: string;
  publisher: string;
  name: string;
  version: string;
  description: string;
  icon?: string;
  engines: PluginEngines;
  entrypoints: PluginEntrypoints;
  permissions: PluginCapability[];
  requires?: Record<string, string>; // e.g. { "host.media.ffmpeg": ">=6 <8" }
}

export interface NetworkRequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: string | FormData | Record<string, any>;
  timeout?: number;
  responseType?: 'json' | 'text' | 'arraybuffer';
}

export interface NetworkResponse<T = any> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
}

export interface DownloadTaskRequest {
  url: string;
  audioUrl?: string; // 可选的独立伴音流（音视频分离场景，宿主将自动使用 FFmpeg 执行无损混流）
  filename: string;
  headers?: Record<string, string>;
  extra?: {
    coverUrl?: string;
    authorName?: string;
    title?: string;
    duration?: number;
    platform?: string;
  };
}

export interface DownloadProgressInfo {
  taskId: string;
  filename: string;
  downloadedBytes: number;
  totalBytes: number;
  progress: number; // 0 to 100
  speed: string;
  status: 'pending' | 'downloading' | 'merging' | 'completed' | 'failed' | 'paused';
  error?: string;
}

export interface ClipboardItem {
  id: string;
  text: string;
  type: 'text';
  timestamp: number;
  charCount: number;
  lineCount: number;
  pinned: boolean;
}

export interface PluginContext {
  pluginId: string;
  version: string;
}

export interface PluginLifecycle {
  activate?(context: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
  dispose?(): void;
}

/**
 * 宿主向沙箱环境注入的 SDK 核心门面
 */
export interface DoujiaoSDK {
  readonly version: string;
  readonly pluginId: string;

  /** 网络请求代理（受控附加 Cookie 与安全 Header） */
  network: {
    request<T = any>(options: NetworkRequestOptions): Promise<NetworkResponse<T>>;
  };

  /** 下载任务引擎（宿主持有生命周期） */
  download: {
    enqueue(task: DownloadTaskRequest): Promise<{ taskId: string }>;
    onProgress(callback: (info: DownloadProgressInfo) => void): () => void; // 返回取消订阅函数
    openSaveDirectory(): Promise<void>;
  };

  /** 浏览器登录会话管理 */
  auth: {
    requestLogin(domain: string): Promise<{ success: boolean; message?: string }>;
    getStatus(domain: string): Promise<{ loggedIn: boolean; nickname?: string }>;
  };

  /** 剪贴板历史管理 */
  clipboard?: {
    getHistory(): Promise<ClipboardItem[]>;
    writeText(text: string): Promise<boolean>;
    deleteItem(id: string): Promise<boolean>;
    clearHistory(): Promise<boolean>;
    togglePin(id: string): Promise<boolean>;
    onChanged(callback: (items: ClipboardItem[]) => void): () => void;
  };

  /** 媒体处理能力（FFmpeg 受控执行） */
  media?: {
    merge(options: { videoPath: string; audioPath: string; outputPath: string }): Promise<{ success: boolean; error?: string }>;
    checkFFmpeg(): Promise<{ installed: boolean; version?: string; path?: string }>;
  };

  /** Samba 文件系统管理能力 */
  samba?: {
    getProfiles(): Promise<SambaProfile[]>;
    saveProfile(profile: SambaProfile): Promise<boolean>;
    deleteProfile(id: string): Promise<boolean>;
    testConnection(config: SambaConfig): Promise<{ success: boolean; error?: string }>;
    connect(profileId: string): Promise<{ success: boolean; error?: string }>;
    disconnect(profileId: string): Promise<boolean>;
    listDirectory(profileId: string, path: string): Promise<SambaFileItem[]>;
    createDirectory(profileId: string, path: string): Promise<boolean>;
    deleteItem(profileId: string, path: string, isDirectory: boolean): Promise<boolean>;
    renameItem(profileId: string, oldPath: string, newPath: string): Promise<boolean>;
    readFileText(profileId: string, path: string, maxBytes?: number): Promise<string>;
    getThumbnail(profileId: string, path: string, mimeType: string, size: number): Promise<string | null>;
    uploadFile(profileId: string, localFilePath: string, remoteDirectory: string): Promise<{ success: boolean; error?: string }>;
    downloadFile(profileId: string, remoteFilePath: string, localSavePath?: string): Promise<{ success: boolean; localPath?: string; error?: string }>;
    selectLocalFile(): Promise<{ canceled: boolean; filePath?: string; fileName?: string; size?: number }>;
    selectLocalDirectory(): Promise<{ canceled: boolean; directoryPath?: string }>;
    onTransferProgress(callback: (progress: SambaTransferProgress) => void): () => void;
  };

  /** UI 交互与通知 */
  ui: {
    notify(options: { message: string; type?: 'info' | 'success' | 'warning' | 'error' }): void;
  };

  /** 注册插件生命周期钩子 */
  lifecycle: {
    register(hooks: PluginLifecycle): void;
  };
}

declare global {
  interface Window {
    doujiaoSDK?: DoujiaoSDK;
  }
}
