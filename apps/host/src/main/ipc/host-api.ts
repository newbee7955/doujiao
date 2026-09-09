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

  // 6. 抖音账号登录管理（宿主外壳层）
  ipcMain.handle('host:auth:douyin-status', async () => {
    return getDouyinLoginStatus()
  })

  ipcMain.handle('host:auth:douyin-login', async () => {
    return await openDouyinLoginWindow()
  })

  // 7. 获取所有下载任务列表
  ipcMain.handle('host:tasks:list', async () => {
    return taskManager.getAllTasks()
  })

  // 8. 取消下载任务
  ipcMain.handle('host:tasks:cancel', async (_, taskId: string) => {
    return taskManager.cancel(taskId)
  })

  // 9. 打开下载保存目录
  ipcMain.handle('host:tasks:open-dir', async () => {
    taskManager.openSaveDirectory()
  })

  // 10. 窗口控制
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
