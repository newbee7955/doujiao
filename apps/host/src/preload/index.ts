import { contextBridge, ipcRenderer } from 'electron'

// 仅向宿主外壳渲染页面暴露特权管理 API
const hostAPI = {
  // 插件容器切换与管理
  showPlugin: (pluginId: string) => ipcRenderer.invoke('host:plugins:show', pluginId),
  hidePlugin: () => ipcRenderer.invoke('host:plugins:hide'),
  listPlugins: () => ipcRenderer.invoke('host:plugins:list'),
  installPluginZip: () => ipcRenderer.invoke('host:plugins:install-zip'),
  uninstallPlugin: (pluginId: string) => ipcRenderer.invoke('host:plugins:uninstall', pluginId),

  // 抖音鉴权管理
  getDouyinStatus: () => ipcRenderer.invoke('host:auth:douyin-status'),
  loginDouyin: () => ipcRenderer.invoke('host:auth:douyin-login'),

  // 任务管理
  listTasks: () => ipcRenderer.invoke('host:tasks:list'),
  cancelTask: (taskId: string) => ipcRenderer.invoke('host:tasks:cancel', taskId),
  openDownloadDir: () => ipcRenderer.invoke('host:tasks:open-dir'),

  // 窗口控制
  minimize: () => ipcRenderer.invoke('host:window:minimize'),
  maximize: () => ipcRenderer.invoke('host:window:maximize'),
  close: () => ipcRenderer.invoke('host:window:close')
}

contextBridge.exposeInMainWorld('hostAPI', hostAPI)

declare global {
  interface Window {
    hostAPI: typeof hostAPI
  }
}
