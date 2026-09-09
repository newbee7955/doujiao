import { app, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import type { WorkspaceFileItem } from '@doujiao/plugin-sdk'

export class WorkspaceService {
  private static instance: WorkspaceService
  private configFile: string
  private config: Record<string, string> = {}

  private constructor() {
    this.configFile = path.join(app.getPath('userData'), 'workspace-config.json')
    this.loadConfig()
  }

  public static getInstance(): WorkspaceService {
    if (!WorkspaceService.instance) {
      WorkspaceService.instance = new WorkspaceService()
    }
    return WorkspaceService.instance
  }

  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configFile)) {
        this.config = JSON.parse(fs.readFileSync(this.configFile, 'utf-8'))
      }
    } catch {
      this.config = {}
    }
  }

  private saveConfig(): void {
    try {
      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[WorkspaceService] 保存配置失败:', err)
    }
  }

  public getDefaultDirectory(scope: string): string {
    const base = path.join(app.getPath('documents'), 'Doujiao')
    const folder = scope === 'markdown-editor' ? 'Markdown' : scope === 'notepad' ? 'Notes' : scope || 'Workspace'
    const target = path.join(base, folder)
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true })
    }
    return target
  }

  public getDirectory(scope: string): string {
    const custom = this.config[scope]
    if (custom && fs.existsSync(custom)) {
      return custom
    }
    return this.getDefaultDirectory(scope)
  }

  public setDirectory(scope: string, dirPath: string): string {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
    this.config[scope] = dirPath
    this.saveConfig()
    return dirPath
  }

  public async selectDirectory(defaultPath?: string): Promise<{ canceled: boolean; directoryPath?: string }> {
    const res = await dialog.showOpenDialog({
      title: '选择工作存储目录',
      defaultPath: defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) {
      return { canceled: true }
    }
    return { canceled: false, directoryPath: res.filePaths[0] }
  }

  public listFiles(scope: string, extensions?: string[]): WorkspaceFileItem[] {
    const dir = this.getDirectory(scope)
    if (!fs.existsSync(dir)) return []

    const extSet = extensions && extensions.length > 0
      ? new Set(extensions.map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`)))
      : null

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const result: WorkspaceFileItem[] = []

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue

        const ext = path.extname(entry.name).toLowerCase()
        if (extSet && !entry.isDirectory() && !extSet.has(ext)) continue

        const fullPath = path.join(dir, entry.name)
        try {
          const stat = fs.statSync(fullPath)
          result.push({
            name: entry.name,
            relativePath: entry.name,
            size: stat.size,
            updatedAt: stat.mtimeMs,
            isDirectory: entry.isDirectory()
          })
        } catch {}
      }

      // 按更新时间倒序
      return result.sort((a, b) => b.updatedAt - a.updatedAt)
    } catch (err) {
      console.error('[WorkspaceService] 读取目录失败:', err)
      return []
    }
  }

  private resolveSafePath(scope: string, relativePath: string): string {
    const dir = this.getDirectory(scope)
    const resolved = path.resolve(dir, relativePath)
    if (!resolved.startsWith(dir)) {
      throw new Error('[Security] 禁止跨越工作目录访问外部路径')
    }
    return resolved
  }

  public readFile(scope: string, relativePath: string): string {
    const fullPath = this.resolveSafePath(scope, relativePath)
    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件不存在: ${relativePath}`)
    }
    return fs.readFileSync(fullPath, 'utf-8')
  }

  public writeFile(scope: string, relativePath: string, content: string): { success: boolean; filePath: string } {
    const fullPath = this.resolveSafePath(scope, relativePath)
    const parent = path.dirname(fullPath)
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true })
    }
    fs.writeFileSync(fullPath, content, 'utf-8')
    return { success: true, filePath: fullPath }
  }

  public deleteFile(scope: string, relativePath: string): boolean {
    const fullPath = this.resolveSafePath(scope, relativePath)
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath)
      return true
    }
    return false
  }

  public renameFile(scope: string, oldName: string, newName: string): boolean {
    const oldPath = this.resolveSafePath(scope, oldName)
    const newPath = this.resolveSafePath(scope, newName)
    if (!fs.existsSync(oldPath)) {
      throw new Error(`原文件不存在: ${oldName}`)
    }
    fs.renameSync(oldPath, newPath)
    return true
  }

  public async openDirectory(scope: string): Promise<void> {
    const dir = this.getDirectory(scope)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    await shell.openPath(dir)
  }
}
