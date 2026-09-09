import { ipcMain, BrowserWindow, dialog } from 'electron'
import { PluginViewContainerManager } from '../container/plugin-view'
import { DownloadTaskManager } from '../tasks/download-manager'
import { PluginManager } from '../plugins/plugin-manager'
import { getDouyinLoginStatus, openDouyinLoginWindow } from '../auth/douyin-auth'

export function registerHostIpc(mainWindow: BrowserWindow): void {
  const containerManager = PluginViewContainerManager.getInstance()
  const taskManager = DownloadTaskManager.getInstance()
  const pluginManager = PluginManager.getInstance()

  // 1. 切换视图：展示插件沙箱
  ipcMain.handle('host:plugins:show', async (_, pluginId: string) => {
    await containerManager.showPlugin(pluginId)
    return { success: true }
  })

  // 2. 切换视图：隐藏当前插件沙箱（返回市场或设置页）
  ipcMain.handle('host:plugins:hide', async () => {
    containerManager.hideCurrentPlugin()
    return { success: true }
  })

  // 3. 插件管理：获取所有插件（包含内置与已安装）
  ipcMain.handle('host:plugins:list', async () => {
    return pluginManager.listAllPlugins()
  })

  // 4. 插件管理：选择并安装本地 ZIP 插件包
  ipcMain.handle('host:plugins:install-zip', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择插件安装包 (ZIP)',
      filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
      properties: ['openFile']
    })

    if (res.canceled || res.filePaths.length === 0) {
      return { canceled: true }
    }

    try {
      const result = await pluginManager.installFromZip(res.filePaths[0])
      return result
    } catch (err: any) {
      console.error('[HostApi] 安装插件失败:', err)
      return { success: false, error: err?.message || '安装失败' }
    }
  })

  // 5. 插件管理：卸载插件
  ipcMain.handle('host:plugins:uninstall', async (_, pluginId: string) => {
    containerManager.destroyPluginView(pluginId)
    const success = pluginManager.uninstallPlugin(pluginId)
    return { success }
  })

  // 6. 插件市场：拉取远端市场聚合清单 (支持强制刷新)
  ipcMain.handle('host:registry:fetch', async (_, forceRefresh?: boolean) => {
    const { RegistryClient } = await import('../plugins/registry-client')
    if (forceRefresh) {
      await RegistryClient.getInstance().fetchRegistry(true)
    }
    return await RegistryClient.getInstance().getMarketPlugins()
  })

  // 7. 插件市场：一键下载、双重验签 (SHA-256 + Ed25519) 并事务安装
  ipcMain.handle(
    'host:registry:install',
    async (_, { pluginId, version }: { pluginId: string; version?: string }) => {
      try {
        const { RegistryClient } = await import('../plugins/registry-client')
        const res = await RegistryClient.getInstance().installFromRegistry(pluginId, version)
        return res
      } catch (err: any) {
        console.error(`[HostApi] 市场安装插件 ${pluginId} 失败:`, err)
        return { success: false, error: err?.message || '安装失败' }
      }
    }
  )

  // 8. 自动更新：检查更新与权限变更差异 (Permission Diff)
  ipcMain.handle('host:updates:check', async () => {
    const { PluginAutoUpdater } = await import('../plugins/auto-updater')
    return await PluginAutoUpdater.getInstance().checkForUpdates()
  })

  // 9. 自动更新：应用更新
  ipcMain.handle(
    'host:updates:apply',
    async (_, { pluginId, version }: { pluginId: string; version?: string }) => {
      try {
        const { RegistryClient } = await import('../plugins/registry-client')
        const res = await RegistryClient.getInstance().installFromRegistry(pluginId, version)
        return res
      } catch (err: any) {
        console.error(`[HostApi] 更新插件 ${pluginId} 失败:`, err)
        return { success: false, error: err?.message || '更新失败' }
      }
    }
  )

  // 10. 独立多媒体组件：FFmpeg 状态检测
  ipcMain.handle('host:ffmpeg:status', async () => {
    const { FFmpegManager } = await import('../media/ffmpeg-manager')
    return await FFmpegManager.getInstance().getStatus()
  })

  // 11. 独立多媒体组件：FFmpeg 一键安装/下载
  ipcMain.handle('host:ffmpeg:install', async () => {
    try {
      const { FFmpegManager } = await import('../media/ffmpeg-manager')
      const status = await FFmpegManager.getInstance().installFFmpeg()
      return { success: true, status }
    } catch (err: any) {
      return { success: false, error: err?.message || '安装失败' }
    }
  })

  // 12. 独立多媒体组件：手动选择本地现有 ffmpeg.exe 导入
  ipcMain.handle('host:ffmpeg:select-file', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择本地已有的 FFmpeg 可执行文件 (ffmpeg.exe)',
      filters: [
        {
          name: 'FFmpeg Executable',
          extensions: process.platform === 'win32' ? ['exe'] : ['*']
        }
      ],
      properties: ['openFile']
    })

    if (res.canceled || res.filePaths.length === 0) {
      return { canceled: true }
    }

    try {
      const { FFmpegManager } = await import('../media/ffmpeg-manager')
      const status = await FFmpegManager.getInstance().importCustomBinary(res.filePaths[0])
      return { success: true, status }
    } catch (err: any) {
      return { success: false, error: err?.message || '导入失败' }
    }
  })

  // 13. 抖音账号登录管理（宿主外壳层）
  ipcMain.handle('host:auth:douyin-status', async () => {
    return getDouyinLoginStatus()
  })

  ipcMain.handle('host:auth:douyin-login', async () => {
    return await openDouyinLoginWindow()
  })

  // 14. 获取所有下载任务列表
  ipcMain.handle('host:tasks:list', async () => {
    return taskManager.getAllTasks()
  })

  // 15. 取消下载任务
  ipcMain.handle('host:tasks:cancel', async (_, taskId: string) => {
    return taskManager.cancel(taskId)
  })

  // 16. 打开下载保存目录
  ipcMain.handle('host:tasks:open-dir', async () => {
    taskManager.openSaveDirectory()
  })

  // 17. 窗口控制
  ipcMain.handle('host:window:minimize', () => mainWindow.minimize())
  ipcMain.handle('host:window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })
  ipcMain.handle('host:window:close', () => mainWindow.close())
}
