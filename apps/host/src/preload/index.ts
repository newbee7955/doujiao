import { contextBridge, ipcRenderer } from 'electron'

// 仅向宿主外壳渲染页面暴露特权管理 API
const hostAPI = {
  // 插件容器切换与管理
  showPlugin: (pluginId: string) => ipcRenderer.invoke('host:plugins:show', pluginId),
  hidePlugin: () => ipcRenderer.invoke('host:plugins:hide'),
  listPlugins: () => ipcRenderer.invoke('host:plugins:list'),
  installPluginZip: () => ipcRenderer.invoke('host:plugins:install-zip'),
  uninstallPlugin: (pluginId: string) => ipcRenderer.invoke('host:plugins:uninstall', pluginId),

  // 市场与远端安装
  fetchMarketPlugins: (forceRefresh?: boolean) =>
    ipcRenderer.invoke('host:registry:fetch', forceRefresh),
  installMarketPlugin: (pluginId: string, version?: string) =>
    ipcRenderer.invoke('host:registry:install', { pluginId, version }),

  // 自动更新与权限差异审计
  checkPluginUpdates: () => ipcRenderer.invoke('host:updates:check'),
  applyPluginUpdate: (pluginId: string, version?: string) =>
    ipcRenderer.invoke('host:updates:apply', { pluginId, version }),

  // 独立多媒体组件 FFmpeg 管理
  getFFmpegStatus: () => ipcRenderer.invoke('host:ffmpeg:status'),
  installFFmpeg: () => ipcRenderer.invoke('host:ffmpeg:install'),
  selectFFmpegFile: () => ipcRenderer.invoke('host:ffmpeg:select-file'),

  // 网络代理与 GitHub 连通性管理
  getProxyStatus: () => ipcRenderer.invoke('host:proxy:get-status'),
  setProxyConfig: (config: any) => ipcRenderer.invoke('host:proxy:set-config', config),
  testGitHubConnectivity: () => ipcRenderer.invoke('host:proxy:test-github'),

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
