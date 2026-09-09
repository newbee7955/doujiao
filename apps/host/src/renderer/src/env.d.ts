/// <reference types="vite/client" />

export interface HostAPI {
  showPlugin: (pluginId: string) => Promise<{ success: boolean }>
  hidePlugin: () => Promise<{ success: boolean }>
  listPlugins: () => Promise<any[]>
  installPluginZip: () => Promise<{ success?: boolean; canceled?: boolean; pluginId?: string; version?: string; error?: string }>
  uninstallPlugin: (pluginId: string) => Promise<{ success: boolean }>
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
