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
