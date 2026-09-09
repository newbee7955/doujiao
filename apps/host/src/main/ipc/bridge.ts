import { ipcMain, net } from 'electron'
import { PluginViewContainerManager } from '../container/plugin-view'
import { DownloadTaskManager } from '../tasks/download-manager'
import {
  getDynamicTtwid,
  getDouyinCookie,
  getDouyinLoginStatus,
  openDouyinLoginWindow
} from '../auth/douyin-auth'
import type { NetworkRequestOptions, DownloadTaskRequest } from '@doujiao/plugin-sdk'

/**
 * 注册插件沙箱受控 IPC 通信桥
 * 强校验 event.sender 来源身份，彻底杜绝伪造 pluginId 越权
 */
export function registerPluginIpcBridge(): void {
  const containerManager = PluginViewContainerManager.getInstance()
  const taskManager = DownloadTaskManager.getInstance()

  // 1. 受控网络请求代理
  ipcMain.handle('plugin:network:request', async (event, options: NetworkRequestOptions) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) {
      throw new Error('[Security] 未经授权的调用来源：非沙箱插件容器')
    }

    try {
      const { url, method = 'GET', headers = {}, body, timeout = 15000 } = options

      const reqHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        ...headers
      }

      // 如果请求发往抖音生态，由宿主自动附加受控 ttwid 与安全登录凭据
      if (url.includes('douyin.com') || url.includes('douyinvod.com') || url.includes('amemv.com')) {
        const ttwid = await getDynamicTtwid()
        const userCookie = getDouyinCookie()
        const cookieParts: string[] = []

        if (ttwid) cookieParts.push(`ttwid=${ttwid}`)
        if (userCookie) cookieParts.push(userCookie)
        if (reqHeaders['Cookie']) cookieParts.push(reqHeaders['Cookie'])

        if (cookieParts.length > 0) {
          reqHeaders['Cookie'] = cookieParts.join('; ')
        }
        if (!reqHeaders['Referer']) {
          reqHeaders['Referer'] = 'https://www.douyin.com/'
        }
        if (!reqHeaders['Accept']) {
          reqHeaders['Accept'] = 'application/json, text/plain, */*'
        }
      }

      const response = await net.fetch(url, {
        method,
        headers: reqHeaders,
        body: typeof body === 'object' ? JSON.stringify(body) : body,
        signal: AbortSignal.timeout(timeout)
      })

      const contentType = response.headers.get('content-type') || ''
      let data: any
      if (contentType.includes('application/json')) {
        data = await response.json()
      } else {
        data = await response.text()
      }

      const resHeaders: Record<string, string> = {}
      response.headers.forEach((val, key) => {
        resHeaders[key] = val
      })

      return {
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders,
        data
      }
    } catch (err: any) {
      console.error(`[PluginBridge:${pluginId}] 网络代理请求失败:`, err)
      throw new Error(`网络请求失败: ${err?.message}`)
    }
  })

  // 2. 隔离登录请求
  ipcMain.handle('plugin:auth:request-login', async (event, domain: string) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) {
      throw new Error('[Security] 未经授权的调用来源')
    }
    if (domain.includes('douyin.com')) {
      return await openDouyinLoginWindow()
    }
    return { success: false, message: `暂不支持该域名的登录: ${domain}` }
  })

  // 3. 登录状态查询
  ipcMain.handle('plugin:auth:get-status', async (event, domain: string) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) {
      throw new Error('[Security] 未经授权的调用来源')
    }
    if (domain.includes('douyin.com')) {
      return getDouyinLoginStatus()
    }
    return { loggedIn: false }
  })

  // 2. 受控推入下载任务
  ipcMain.handle('plugin:download:enqueue', async (event, taskReq: DownloadTaskRequest) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) {
      throw new Error('[Security] 未经授权的调用来源')
    }

    const taskId = await taskManager.enqueue(taskReq, pluginId)
    return { taskId }
  })

  // 3. 打开下载目录
  ipcMain.handle('plugin:download:open-dir', async (event) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) throw new Error('[Security] 未经授权的调用来源')
    taskManager.openSaveDirectory()
  })

  // 5. 媒体处理：查询 FFmpeg 状态
  ipcMain.handle('plugin:media:check-ffmpeg', async (event) => {
    const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
    if (!pluginId) throw new Error('[Security] 未经授权的调用来源')
    const { FFmpegManager } = await import('../media/ffmpeg-manager')
    return await FFmpegManager.getInstance().getStatus()
  })

  // 6. 媒体处理：受控音视频混流 (需要 media.merge 权限)
  ipcMain.handle(
    'plugin:media:merge',
    async (
      event,
      options: { videoPath: string; audioPath: string; outputPath: string }
    ) => {
      const pluginId = containerManager.getPluginIdByWebContentsId(event.sender.id)
      if (!pluginId) throw new Error('[Security] 未经授权的调用来源')

      const { PluginManager } = await import('../plugins/plugin-manager')
      const plugin = PluginManager.getInstance().getPlugin(pluginId)
      const hasPermission = plugin?.manifest?.permissions?.some(
        (p: any) => p.capability === 'media.merge'
      )
      if (!hasPermission) {
        throw new Error(
          `[Security] 插件 ${pluginId} 未在 manifest.json 中声明 media.merge 权限，拒绝调用`
        )
      }

      const { FFmpegManager } = await import('../media/ffmpeg-manager')
      return await FFmpegManager.getInstance().mergeMedia(
        options.videoPath,
        options.audioPath,
        options.outputPath
      )
    }
  )

  // 7. 监听下载进度（向当前沙箱转发本插件相关的任务进度）
  taskManager.subscribe((info) => {
    eventBroadcast(info)
  })

  function eventBroadcast(info: any) {
    for (const [, instance] of (containerManager as any).views.entries()) {
      if (instance.isAttached && !instance.view.webContents.isDestroyed()) {
        instance.view.webContents.send('plugin:download:progress', info)
      }
    }
  }
}

