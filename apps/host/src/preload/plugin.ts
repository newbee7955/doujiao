import { contextBridge, ipcRenderer } from 'electron'
import type {
  DoujiaoSDK,
  NetworkRequestOptions,
  DownloadTaskRequest,
  DownloadProgressInfo,
  PluginLifecycle
} from '@doujiao/plugin-sdk'

let registeredLifecycle: PluginLifecycle | null = null

// 从沙箱自定义协议 URL (如 doujiao-plugin://<plugin-id>/index.html) 动态解析宿主分配的真实 pluginId
const currentPluginId =
  typeof window !== 'undefined' && window.location?.hostname
    ? window.location.hostname
    : 'plugin-sandbox'

const sdk: DoujiaoSDK = {
  version: '2.0.0',
  pluginId: currentPluginId,

  network: {
    request: <T = any>(options: NetworkRequestOptions) => {
      return ipcRenderer.invoke('plugin:network:request', options) as Promise<{
        status: number;
        statusText: string;
        headers: Record<string, string>;
        data: T;
      }>
    }
  },

  download: {
    enqueue: (task: DownloadTaskRequest) => {
      return ipcRenderer.invoke('plugin:download:enqueue', task)
    },
    onProgress: (callback: (info: DownloadProgressInfo) => void) => {
      const handler = (_: any, info: DownloadProgressInfo) => {
        try {
          callback(info)
        } catch (err) {
          console.error('[DoujiaoSDK] 进度监听执行错误:', err)
        }
      }
      ipcRenderer.on('plugin:download:progress', handler)
      // 返回取消订阅函数 (避免重复监听或内存泄漏)
      return () => {
        ipcRenderer.removeListener('plugin:download:progress', handler)
      }
    },
    openSaveDirectory: () => {
      return ipcRenderer.invoke('plugin:download:open-dir')
    }
  },

  auth: {
    requestLogin: (domain: string) => {
      return ipcRenderer.invoke('plugin:auth:request-login', domain)
    },
    getStatus: (domain: string) => {
      return ipcRenderer.invoke('plugin:auth:get-status', domain)
    }
  },

  media: {
    merge: (options: { videoPath: string; audioPath: string; outputPath: string }) => {
      return ipcRenderer.invoke('plugin:media:merge', options)
    },
    checkFFmpeg: () => {
      return ipcRenderer.invoke('plugin:media:check-ffmpeg')
    }
  },

  clipboard: {
    getHistory: () => ipcRenderer.invoke('plugin:clipboard:get-history'),
    writeText: (text: string) => ipcRenderer.invoke('plugin:clipboard:write-text', text),
    deleteItem: (id: string) => ipcRenderer.invoke('plugin:clipboard:delete', id),
    clearHistory: () => ipcRenderer.invoke('plugin:clipboard:clear'),
    togglePin: (id: string) => ipcRenderer.invoke('plugin:clipboard:toggle-pin', id),
    onChanged: (callback: (items: any[]) => void) => {
      const handler = (_: any, items: any[]) => {
        try {
          callback(items)
        } catch (err) {
          console.error('[DoujiaoSDK] 剪贴板监听回调异常:', err)
        }
      }
      ipcRenderer.on('plugin:clipboard:changed', handler)
      return () => {
        ipcRenderer.removeListener('plugin:clipboard:changed', handler)
      }
    }
  },

  samba: {
    getProfiles: () => ipcRenderer.invoke('plugin:samba:get-profiles'),
    saveProfile: (profile: any) => ipcRenderer.invoke('plugin:samba:save-profile', profile),
    deleteProfile: (id: string) => ipcRenderer.invoke('plugin:samba:delete-profile', id),
    testConnection: (config: any) => ipcRenderer.invoke('plugin:samba:test-connection', config),
    connect: (profileId: string) => ipcRenderer.invoke('plugin:samba:connect', profileId),
    disconnect: (profileId: string) => ipcRenderer.invoke('plugin:samba:disconnect', profileId),
    listDirectory: (profileId: string, path: string) =>
      ipcRenderer.invoke('plugin:samba:list-directory', profileId, path),
    createDirectory: (profileId: string, path: string) =>
      ipcRenderer.invoke('plugin:samba:create-directory', profileId, path),
    deleteItem: (profileId: string, path: string, isDirectory: boolean) =>
      ipcRenderer.invoke('plugin:samba:delete-item', profileId, path, isDirectory),
    renameItem: (profileId: string, oldPath: string, newPath: string) =>
      ipcRenderer.invoke('plugin:samba:rename-item', profileId, oldPath, newPath),
    readFileText: (profileId: string, path: string, maxBytes?: number) =>
      ipcRenderer.invoke('plugin:samba:read-file-text', profileId, path, maxBytes),
    getThumbnail: (profileId: string, path: string, mimeType: string, size: number) =>
      ipcRenderer.invoke('plugin:samba:get-thumbnail', profileId, path, mimeType, size),
    uploadFile: (profileId: string, localFilePath: string, remoteDirectory: string) =>
      ipcRenderer.invoke('plugin:samba:upload-file', profileId, localFilePath, remoteDirectory),
    downloadFile: (profileId: string, remoteFilePath: string, localSavePath?: string) =>
      ipcRenderer.invoke('plugin:samba:download-file', profileId, remoteFilePath, localSavePath),
    selectLocalFile: () => ipcRenderer.invoke('plugin:samba:select-local-file'),
    selectLocalDirectory: () => ipcRenderer.invoke('plugin:samba:select-local-directory'),
    onTransferProgress: (callback: (progress: any) => void) => {
      const handler = (_: any, progress: any) => {
        try {
          callback(progress)
        } catch (err) {
          console.error('[DoujiaoSDK] Samba 传输进度回调异常:', err)
        }
      }
      ipcRenderer.on('plugin:samba:transfer-progress', handler)
      return () => {
        ipcRenderer.removeListener('plugin:samba:transfer-progress', handler)
      }
    }
  },

  lan: {
    startServer: (options?: any) => ipcRenderer.invoke('plugin:lan:start-server', options),
    stopServer: () => ipcRenderer.invoke('plugin:lan:stop-server'),
    getStatus: () => ipcRenderer.invoke('plugin:lan:get-status'),
    switchIp: (ip: string) => ipcRenderer.invoke('plugin:lan:switch-ip', ip),
    setAuthEnabled: (enabled: boolean) => ipcRenderer.invoke('plugin:lan:set-auth-enabled', enabled),
    refreshPin: () => ipcRenderer.invoke('plugin:lan:refresh-pin'),
    setAutoPinInQr: (enabled: boolean) => ipcRenderer.invoke('plugin:lan:set-auto-pin-in-qr', enabled),
    addShareFiles: (filePaths: string[]) => ipcRenderer.invoke('plugin:lan:add-share-files', filePaths),
    removeShareFile: (id: string) => ipcRenderer.invoke('plugin:lan:remove-share-file', id),
    getShareFiles: () => ipcRenderer.invoke('plugin:lan:get-share-files'),
    getReceivedFiles: () => ipcRenderer.invoke('plugin:lan:get-received-files'),
    deleteReceivedFile: (id: string) => ipcRenderer.invoke('plugin:lan:delete-received-file', id),
    openFile: (localPath: string) => ipcRenderer.invoke('plugin:lan:open-file', localPath),
    showItemInFolder: (localPath: string) => ipcRenderer.invoke('plugin:lan:show-item-in-folder', localPath),
    selectFilesToSend: () => ipcRenderer.invoke('plugin:lan:select-files-to-send'),
    selectSaveDirectory: () => ipcRenderer.invoke('plugin:lan:select-save-directory'),
    openSaveDirectory: () => ipcRenderer.invoke('plugin:lan:open-save-directory'),
    sendTextMessage: (text: string) => ipcRenderer.invoke('plugin:lan:send-text-message', text),
    getMessages: () => ipcRenderer.invoke('plugin:lan:get-messages'),
    clearMessages: () => ipcRenderer.invoke('plugin:lan:clear-messages'),
    onEvent: (callback: (event: any) => void) => {
      const handler = (_: any, event: any) => {
        try {
          callback(event)
        } catch (err) {
          console.error('[DoujiaoSDK] 局域网传输事件监听回调异常:', err)
        }
      }
      ipcRenderer.on('plugin:lan:event', handler)
      return () => {
        ipcRenderer.removeListener('plugin:lan:event', handler)
      }
    }
  },

  ui: {
    notify: (options) => {
      console.log(`[PluginToast] [${options.type || 'info'}] ${options.message}`)
    }
  },

  lifecycle: {
    register: (hooks: PluginLifecycle) => {
      registeredLifecycle = hooks
      if (hooks.activate) {
        hooks.activate({ pluginId: currentPluginId, version: '2.0.0' })
      }
    }
  }
}

// 仅向沙箱暴露经过封装的受控 SDK，严禁暴露 ipcRenderer 和 Node 原始能力
contextBridge.exposeInMainWorld('doujiaoSDK', sdk)
