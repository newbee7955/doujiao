import { app, shell } from 'electron'
import { join } from 'path'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import https from 'https'
import http from 'http'
import { URL } from 'url'
import type { DownloadTaskRequest, DownloadProgressInfo } from '@doujiao/plugin-sdk'

export interface ManagedTask {
  id: string;
  pluginId: string;
  filename: string;
  url: string;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  speed: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';
  error?: string;
  abortController?: AbortController;
  savePath: string;
  createdAt: number;
}

export class DownloadTaskManager {
  private static instance: DownloadTaskManager
  private tasks: Map<string, ManagedTask> = new Map()
  private listeners: Set<(info: DownloadProgressInfo) => void> = new Set()
  private downloadDir: string

  private constructor() {
    this.downloadDir = join(app.getPath('downloads'), 'doujiao')
    if (!existsSync(this.downloadDir)) {
      mkdirSync(this.downloadDir, { recursive: true })
    }
  }

  public static getInstance(): DownloadTaskManager {
    if (!DownloadTaskManager.instance) {
      DownloadTaskManager.instance = new DownloadTaskManager()
    }
    return DownloadTaskManager.instance
  }

  public getDownloadDir(): string {
    return this.downloadDir
  }

  public openSaveDirectory(): void {
    if (existsSync(this.downloadDir)) {
      shell.openPath(this.downloadDir)
    }
  }

  public subscribe(callback: (info: DownloadProgressInfo) => void): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  private notifyProgress(task: ManagedTask): void {
    const info: DownloadProgressInfo = {
      taskId: task.id,
      filename: task.filename,
      downloadedBytes: task.downloadedBytes,
      totalBytes: task.totalBytes,
      progress: task.progress,
      speed: task.speed,
      status: task.status,
      error: task.error
    }
    for (const listener of this.listeners) {
      try {
        listener(info)
      } catch (err) {
        console.error(`[TaskManager] 通知监听异常:`, err)
      }
    }
  }

  public async enqueue(taskReq: DownloadTaskRequest, pluginId: string): Promise<string> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    
    // 清理文件名非法字符
    const sanitizedFilename = (taskReq.filename || `download_${taskId}.mp4`)
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim()
    const savePath = join(this.downloadDir, sanitizedFilename)

    const managedTask: ManagedTask = {
      id: taskId,
      pluginId,
      filename: sanitizedFilename,
      url: taskReq.url,
      downloadedBytes: 0,
      totalBytes: 0,
      progress: 0,
      speed: '0 KB/s',
      status: 'pending',
      savePath,
      createdAt: Date.now()
    }

    this.tasks.set(taskId, managedTask)
    this.notifyProgress(managedTask)

    // 异步启动下载流程
    this.startDownload(managedTask, taskReq.headers)

    return taskId
  }

  public cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false

    if (task.abortController) {
      task.abortController.abort()
    }
    task.status = 'failed'
    task.error = '用户取消下载'
    this.notifyProgress(task)
    return true
  }

  public getAllTasks(): ManagedTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  private startDownload(task: ManagedTask, customHeaders?: Record<string, string>): void {
    task.status = 'downloading'
    task.abortController = new AbortController()
    this.notifyProgress(task)

    try {
      const parsedUrl = new URL(task.url)
      const isHttps = parsedUrl.protocol === 'https:'
      const requestModule = isHttps ? https : http

      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        ...customHeaders
      }

      const req = requestModule.get(
        task.url,
        {
          headers,
          signal: task.abortController.signal
        },
        (res) => {
          // 处理 301/302 重定向
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            task.url = res.headers.location
            this.startDownload(task, customHeaders)
            return
          }

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            task.status = 'failed'
            task.error = `HTTP 状态异常: ${res.statusCode}`
            this.notifyProgress(task)
            return
          }

          const contentLength = res.headers['content-length']
          task.totalBytes = contentLength ? parseInt(contentLength, 10) : 0

          const fileStream = createWriteStream(task.savePath)
          let lastBytes = 0
          let lastTime = Date.now()

          res.on('data', (chunk: Buffer) => {
            task.downloadedBytes += chunk.length

            const now = Date.now()
            if (now - lastTime >= 500) {
              const deltaBytes = task.downloadedBytes - lastBytes
              const deltaTime = (now - lastTime) / 1000
              const bytesPerSec = deltaBytes / deltaTime
              task.speed =
                bytesPerSec > 1024 * 1024
                  ? `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
                  : `${(bytesPerSec / 1024).toFixed(0)} KB/s`

              if (task.totalBytes > 0) {
                task.progress = Math.min(
                  99,
                  Math.round((task.downloadedBytes / task.totalBytes) * 100)
                )
              }

              lastBytes = task.downloadedBytes
              lastTime = now
              this.notifyProgress(task)
            }
          })

          res.pipe(fileStream)

          fileStream.on('finish', () => {
            fileStream.close()
            task.progress = 100
            task.status = 'completed'
            task.speed = '完成'
            this.notifyProgress(task)
          })

          fileStream.on('error', (err) => {
            task.status = 'failed'
            task.error = err.message
            this.notifyProgress(task)
          })
        }
      )

      req.on('error', (err: any) => {
        if (task.abortController?.signal.aborted) {
          task.status = 'failed'
          task.error = '下载已取消'
        } else {
          task.status = 'failed'
          task.error = err.message
        }
        this.notifyProgress(task)
      })
    } catch (err: any) {
      task.status = 'failed'
      task.error = err?.message || '初始化请求失败'
      this.notifyProgress(task)
    }
  }
}
