import { app, clipboard } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { EventEmitter } from 'events'
import type { ClipboardItem } from '@doujiao/plugin-sdk'

const MAX_HISTORY_ITEMS = 500

export class ClipboardHistoryService extends EventEmitter {
  private static instance: ClipboardHistoryService
  private items: ClipboardItem[] = []
  private storageFile: string
  private lastCopiedText: string = ''
  private timer: NodeJS.Timeout | null = null

  private constructor() {
    super()
    this.storageFile = join(app.getPath('userData'), 'clipboard-history.json')
    this.loadFromDisk()
    this.startWatching()
  }

  public static getInstance(): ClipboardHistoryService {
    if (!ClipboardHistoryService.instance) {
      ClipboardHistoryService.instance = new ClipboardHistoryService()
    }
    return ClipboardHistoryService.instance
  }

  private loadFromDisk(): void {
    if (existsSync(this.storageFile)) {
      try {
        const raw = readFileSync(this.storageFile, 'utf-8')
        const parsed = JSON.parse(raw)
        let rawList: any[] = []
        if (Array.isArray(parsed)) {
          rawList = parsed
        } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).items)) {
          rawList = (parsed as any).items
        }

        // 统一规范化清洗数据
        this.items = rawList
          .map((item: any) => {
            const text = (item.text || item.content || '').toString()
            return {
              id: item.id || `clip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              text: text,
              type: 'text' as const,
              timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
              charCount: typeof item.charCount === 'number' ? item.charCount : text.length,
              lineCount: typeof item.lineCount === 'number' ? item.lineCount : (text ? text.split(/\r?\n/).length : 1),
              pinned: Boolean(item.pinned)
            }
          })
          .filter((item) => item.text && item.text.trim())

        if (this.items.length > 0) {
          this.lastCopiedText = this.items[0].text
        }
      } catch (err) {
        console.warn('[ClipboardService] 读取剪贴板历史文件失败，初始化为空:', err)
        this.items = []
      }
    } else {
      this.items = []
    }
  }

  private saveToDisk(): void {
    try {
      writeFileSync(this.storageFile, JSON.stringify(this.items, null, 2), 'utf-8')
    } catch (err) {
      console.error('[ClipboardService] 写入剪贴板历史失败:', err)
    }
  }

  private startWatching(): void {
    // 初始化同步一次系统当前剪贴板
    try {
      const current = clipboard.readText()
      if (current && current.trim()) {
        this.lastCopiedText = current
      }
    } catch {}

    this.timer = setInterval(() => {
      this.checkClipboard()
    }, 800)
  }

  private checkClipboard(): void {
    try {
      const text = clipboard.readText()
      if (!text || !text.trim() || text === this.lastCopiedText) {
        return
      }

      this.lastCopiedText = text
      this.addItem(text)
    } catch (err) {
      // 忽略读取剪贴板异常 (可能偶发被其他进程独占锁定)
    }
  }

  private addItem(text: string): void {
    const existingIndex = this.items.findIndex((i) => i.text === text)
    if (existingIndex >= 0) {
      // 若已存在，移至最前端并更新时间
      const [existing] = this.items.splice(existingIndex, 1)
      existing.timestamp = Date.now()
      this.items.unshift(existing)
    } else {
      const newItem: ClipboardItem = {
        id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text,
        type: 'text',
        timestamp: Date.now(),
        charCount: text.length,
        lineCount: text.split(/\r?\n/).length,
        pinned: false
      }
      this.items.unshift(newItem)
    }

    // 容量上限裁剪（保留置顶项）
    if (this.items.length > MAX_HISTORY_ITEMS) {
      const pinned = this.items.filter((i) => i.pinned)
      const unpinned = this.items.filter((i) => !i.pinned).slice(0, MAX_HISTORY_ITEMS - pinned.length)
      this.items = [...pinned, ...unpinned].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.timestamp - a.timestamp
      })
    }

    this.saveToDisk()
    this.emit('changed', this.items)
  }

  public getHistory(): ClipboardItem[] {
    return [...this.items]
  }

  public writeText(text: string): boolean {
    try {
      this.lastCopiedText = text
      clipboard.writeText(text)
      // 同时将其推入或置顶到历史列表
      this.addItem(text)
      return true
    } catch (err) {
      console.error('[ClipboardService] 写入剪贴板失败:', err)
      return false
    }
  }

  public deleteItem(id: string): boolean {
    const idx = this.items.findIndex((i) => i.id === id)
    if (idx >= 0) {
      this.items.splice(idx, 1)
      this.saveToDisk()
      this.emit('changed', this.items)
      return true
    }
    return false
  }

  public clearHistory(): boolean {
    // 仅清除未置顶的项
    this.items = this.items.filter((i) => i.pinned)
    this.saveToDisk()
    this.emit('changed', this.items)
    return true
  }

  public togglePin(id: string): boolean {
    const item = this.items.find((i) => i.id === id)
    if (item) {
      item.pinned = !item.pinned
      this.saveToDisk()
      this.emit('changed', this.items)
      return true
    }
    return false
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
