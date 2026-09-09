/// <reference types="vite/client" />

export interface HostAPI {
  showPlugin: (pluginId: string) => Promise<{ success: boolean }>
  hidePlugin: () => Promise<{ success: boolean }>
  listPlugins: () => Promise<any[]>
  installPluginZip: () => Promise<{ success?: boolean; canceled?: boolean; pluginId?: string; version?: string; error?: string }>
  uninstallPlugin: (pluginId: string) => Promise<{ success: boolean }>

  fetchMarketPlugins: (forceRefresh?: boolean) => Promise<any>
  installMarketPlugin: (pluginId: string, version?: string) => Promise<{ success: boolean; pluginId?: string; version?: string; error?: string }>
  checkPluginUpdates: () => Promise<any[]>
  applyPluginUpdate: (pluginId: string, version?: string) => Promise<{ success: boolean; pluginId?: string; version?: string; error?: string }>

  getProxyStatus?: () => Promise<any>
  setProxyConfig?: (config: any) => Promise<any>
  testGitHubConnectivity?: () => Promise<any>

  getFFmpegStatus: () => Promise<{ installed: boolean; version?: string; path?: string; source?: string; error?: string }>
  installFFmpeg: () => Promise<{ success: boolean; status?: any; error?: string }>
  selectFFmpegFile: () => Promise<{ success?: boolean; canceled?: boolean; status?: any; error?: string }>
  openFFmpegDir: () => Promise<{ success: boolean; error?: string }>
  onFFmpegInstallProgress?: (callback: (progress: { percent: number; speed?: string; text?: string }) => void) => () => void

  getDouyinStatus: () => Promise<{ loggedIn: boolean }>
  loginDouyin: () => Promise<{ success: boolean; message?: string }>
  listTasks: () => Promise<any[]>
  cancelTask: (taskId: string) => Promise<boolean>
  openDownloadDir: () => Promise<void>
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
}

declare global {
  interface Window {
    hostAPI?: HostAPI
  }
}
