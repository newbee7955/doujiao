import { app, dialog, nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import SMB2 from '@marsaud/smb2'
import type {
  SambaConfig,
  SambaProfile,
  SambaFileItem,
  SambaTransferProgress
} from '@doujiao/plugin-sdk'
import { FFmpegManager } from '../media/ffmpeg-manager'

interface ActiveClient {
  client: any
  profile: SambaProfile
  lastUsed: number
}

export class SambaService {
  private static instance: SambaService
  private activeClients = new Map<string, ActiveClient>()
  private profilesPath: string
  private thumbsDir: string
  private progressListeners = new Set<(progress: SambaTransferProgress) => void>()

  private constructor() {
    const userData = app.getPath('userData')
    this.profilesPath = path.join(userData, 'samba-profiles.json')
    this.thumbsDir = path.join(userData, 'samba-thumbs')
    if (!fs.existsSync(this.thumbsDir)) {
      try {
        fs.mkdirSync(this.thumbsDir, { recursive: true })
      } catch (err) {
        console.error('[SambaService] Failed to create thumbs dir:', err)
      }
    }
  }

  public static getInstance(): SambaService {
    if (!SambaService.instance) {
      SambaService.instance = new SambaService()
    }
    return SambaService.instance
  }

  public onProgress(listener: (progress: SambaTransferProgress) => void): () => void {
    this.progressListeners.add(listener)
    return () => this.progressListeners.delete(listener)
  }

  private notifyProgress(progress: SambaTransferProgress): void {
    for (const listener of this.progressListeners) {
      try {
        listener(progress)
      } catch (err) {
        console.error('[SambaService] Error in progress listener:', err)
      }
    }
  }

  // --- 规范化路径 ---
  public normalizeSambaPath(p: string): string {
    if (!p || p === '/' || p === '\\' || p === '.') return ''
    return p.replace(/\//g, '\\').replace(/^\\+/, '').replace(/\\+$/, '')
  }

  public resolvePath(basePath: string | undefined, subPath: string): string {
    const normBase = this.normalizeSambaPath(basePath || '')
    const normSub = this.normalizeSambaPath(subPath || '')
    if (!normBase) return normSub
    if (!normSub) return normBase
    return `${normBase}\\${normSub}`
  }

  // --- 配置文件持久化 ---
  public async getProfiles(): Promise<SambaProfile[]> {
    try {
      if (!fs.existsSync(this.profilesPath)) {
        return []
      }
      const raw = await fs.promises.readFile(this.profilesPath, 'utf8')
      return JSON.parse(raw)
    } catch (err) {
      console.error('[SambaService] Failed to read profiles:', err)
      return []
    }
  }

  public async saveProfile(profile: SambaProfile): Promise<boolean> {
    try {
      const profiles = await this.getProfiles()
      const idx = profiles.findIndex((p) => p.id === profile.id)
      if (idx >= 0) {
        profiles[idx] = profile
      } else {
        profiles.push(profile)
      }
      await fs.promises.writeFile(this.profilesPath, JSON.stringify(profiles, null, 2), 'utf8')
      return true
    } catch (err) {
      console.error('[SambaService] Failed to save profile:', err)
      return false
    }
  }

  public async deleteProfile(id: string): Promise<boolean> {
    try {
      await this.disconnect(id)
      const profiles = await this.getProfiles()
      const filtered = profiles.filter((p) => p.id !== id)
      await fs.promises.writeFile(this.profilesPath, JSON.stringify(filtered, null, 2), 'utf8')
      return true
    } catch (err) {
      console.error('[SambaService] Failed to delete profile:', err)
      return false
    }
  }

  // --- 客户端实例获取与连接测试 ---
  private createClient(config: SambaConfig): any {
    const cleanShare = config.share.replace(/^\\+/, '').replace(/\\+$/, '').replace(/\//g, '')
    const shareUrl = `\\\\${config.host}\\${cleanShare}`
    return new SMB2({
      share: shareUrl,
      port: config.port ? Number(config.port) : 445,
      domain: config.domain || config.workgroup || 'WORKGROUP',
      username: config.username || '',
      password: config.password || '',
      autoCloseTimeout: 0
    })
  }

  public async testConnection(config: SambaConfig): Promise<{ success: boolean; error?: string }> {
    let client: any = null
    try {
      client = this.createClient(config)
      const targetPath = this.normalizeSambaPath(config.basePath || '')
      await new Promise<void>((resolve, reject) => {
        client.readdir(targetPath, (err: any) => {
          if (err) return reject(err)
          resolve()
        })
      })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    } finally {
      if (client) {
        try {
          client.disconnect()
        } catch (_) {}
      }
    }
  }

  public async connect(profileId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.activeClients.has(profileId)) {
        return { success: true }
      }
      const profiles = await this.getProfiles()
      const profile = profiles.find((p) => p.id === profileId)
      if (!profile) {
        return { success: false, error: '找不到指定的连接配置' }
      }

      const client = this.createClient(profile.config)
      const targetPath = this.normalizeSambaPath(profile.config.basePath || '')

      await new Promise<void>((resolve, reject) => {
        client.readdir(targetPath, (err: any) => {
          if (err) return reject(err)
          resolve()
        })
      })

      profile.lastConnected = Date.now()
      await this.saveProfile(profile)

      this.activeClients.set(profileId, {
        client,
        profile,
        lastUsed: Date.now()
      })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  }

  public async disconnect(profileId: string): Promise<boolean> {
    const active = this.activeClients.get(profileId)
    if (active) {
      try {
        active.client.disconnect()
      } catch (_) {}
      this.activeClients.delete(profileId)
    }
    return true
  }

  private async getActiveClient(profileId: string): Promise<any> {
    let active = this.activeClients.get(profileId)
    if (!active) {
      const conn = await this.connect(profileId)
      if (!conn.success) {
        throw new Error(`连接失败: ${conn.error}`)
      }
      active = this.activeClients.get(profileId)
    }
    if (!active) {
      throw new Error('未建立与 Samba 服务器的有效连接')
    }
    active.lastUsed = Date.now()
    return active.client
  }

  // --- 文件与目录管理 ---
  public async listDirectory(profileId: string, dirPath: string): Promise<SambaFileItem[]> {
    const client = await this.getActiveClient(profileId)
    const normPath = this.normalizeSambaPath(dirPath)

    return new Promise((resolve, reject) => {
      client.readdir(normPath, { stats: true }, (err: any, files: any[]) => {
        if (err) return reject(err)
        if (!Array.isArray(files)) return resolve([])

        const items: SambaFileItem[] = files.map((f: any) => {
          const isDir = typeof f.isDirectory === 'function' ? f.isDirectory() : Boolean(f.isDirectory)
          const ext = isDir ? '' : path.extname(f.name || '').toLowerCase().replace('.', '')
          const itemPath = normPath ? `${normPath}\\${f.name}` : f.name
          return {
            name: f.name,
            path: itemPath.replace(/\\/g, '/'),
            isDirectory: isDir,
            size: f.size || 0,
            mtime: f.mtime ? new Date(f.mtime).getTime() : Date.now(),
            birthtime: f.birthtime ? new Date(f.birthtime).getTime() : undefined,
            extension: ext
          }
        })

        // 目录在前，文件在后，按字母顺序排序
        items.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1
          if (!a.isDirectory && b.isDirectory) return 1
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        })

        resolve(items)
      })
    })
  }

  public async createDirectory(profileId: string, dirPath: string): Promise<boolean> {
    const client = await this.getActiveClient(profileId)
    const normPath = this.normalizeSambaPath(dirPath)
    return new Promise((resolve, reject) => {
      client.mkdir(normPath, (err: any) => {
        if (err) return reject(err)
        resolve(true)
      })
    })
  }

  public async deleteItem(profileId: string, targetPath: string, isDirectory: boolean): Promise<boolean> {
    const client = await this.getActiveClient(profileId)
    const normPath = this.normalizeSambaPath(targetPath)
    return new Promise((resolve, reject) => {
      const fn = isDirectory ? client.rmdir.bind(client) : client.unlink.bind(client)
      fn(normPath, (err: any) => {
        if (err) return reject(err)
        resolve(true)
      })
    })
  }

  public async renameItem(profileId: string, oldPath: string, newPath: string): Promise<boolean> {
    const client = await this.getActiveClient(profileId)
    const normOld = this.normalizeSambaPath(oldPath)
    const normNew = this.normalizeSambaPath(newPath)
    return new Promise((resolve, reject) => {
      client.rename(normOld, normNew, (err: any) => {
        if (err) return reject(err)
        resolve(true)
      })
    })
  }

  public async readFileText(profileId: string, filePath: string, maxBytes = 1024 * 512): Promise<string> {
    const client = await this.getActiveClient(profileId)
    const normPath = this.normalizeSambaPath(filePath)
    const buffer = await this.readPartialBytes(client, normPath, maxBytes)
    return buffer.toString('utf8')
  }

  // --- 局部首部字节读取辅助 ---
  private readPartialBytes(client: any, smbPath: string, maxBytes: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      client.open(smbPath, 'r', (err: any, fd: number) => {
        if (err) return reject(err)
        const buf = Buffer.alloc(maxBytes)
        client.read(fd, buf, 0, maxBytes, 0, (readErr: any, bytesRead: number) => {
          client.close(fd, () => {})
          if (readErr && (!bytesRead || bytesRead <= 0)) {
            return reject(readErr)
          }
          resolve(buf.subarray(0, bytesRead || 0))
        })
      })
    })
  }

  // --- EXIF APP1 IFD1 缩略图解析 (仅需前 64KB) ---
  private extractExifThumb(buf: Buffer): Buffer | null {
    if (!buf || buf.length < 128) return null
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return null

    let offset = 2
    while (offset < buf.length - 4) {
      if (buf[offset] !== 0xff) break
      const marker = buf[offset + 1]
      const len = buf.readUInt16BE(offset + 2)
      if (marker === 0xe1) {
        // APP1
        const exifHeader = buf.subarray(offset + 4, offset + 10).toString('latin1')
        if (exifHeader.startsWith('Exif\0\0')) {
          const tiff = offset + 10
          if (tiff + 8 > buf.length) return null
          const isLE = buf.readUInt16BE(tiff) === 0x4949
          const read16 = (o: number) => (isLE ? buf.readUInt16LE(tiff + o) : buf.readUInt16BE(tiff + o))
          const read32 = (o: number) => (isLE ? buf.readUInt32LE(tiff + o) : buf.readUInt32BE(tiff + o))

          if (read16(2) !== 0x002a) return null
          const ifd0 = read32(4)
          if (ifd0 + 2 > buf.length - tiff) return null
          const ifd0Count = read16(ifd0)
          const ifd1OffsetPtr = ifd0 + 2 + ifd0Count * 12
          if (ifd1OffsetPtr + 4 > buf.length - tiff) return null
          const ifd1 = read32(ifd1OffsetPtr)
          if (ifd1 === 0 || ifd1 + 2 > buf.length - tiff) return null

          const ifd1Count = read16(ifd1)
          let thumbOffset = 0
          let thumbLen = 0
          for (let i = 0; i < ifd1Count; i++) {
            const entry = ifd1 + 2 + i * 12
            if (entry + 12 > buf.length - tiff) break
            const tag = read16(entry)
            if (tag === 0x0201) thumbOffset = read32(entry + 8)
            else if (tag === 0x0202) thumbLen = read32(entry + 8)
          }

          if (thumbOffset > 0 && thumbLen > 0 && tiff + thumbOffset + thumbLen <= buf.length) {
            return buf.subarray(tiff + thumbOffset, tiff + thumbOffset + thumbLen)
          }
        }
      }
      offset += 2 + len
    }
    return null
  }

  // --- 视频首部关键帧抽取 (通过 FFmpeg 管道) ---
  private extractVideoFrame(ffmpegPath: string, buffer: Buffer): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const args = [
        '-ss', '00:00:00.5',
        '-i', 'pipe:0',
        '-vframes', '1',
        '-s', '200x112',
        '-f', 'image2',
        'pipe:1'
      ]
      const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'ignore'] })
      const chunks: Buffer[] = []
      proc.stdout.on('data', (d) => chunks.push(d))
      proc.on('close', (code) => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks))
        } else {
          resolve(null)
        }
      })
      proc.on('error', () => resolve(null))

      proc.stdin.write(buffer)
      proc.stdin.end()
    })
  }

  // --- 高性能图片与视频缩略图核心调度 ---
  public async getThumbnail(
    profileId: string,
    filePath: string,
    mimeType: string,
    size: number
  ): Promise<string | null> {
    const ext = path.extname(filePath).toLowerCase()
    const isImage = /\.(jpe?g|png|webp|bmp|gif)$/i.test(ext) || mimeType.startsWith('image/')
    const isVideo = /\.(mp4|mkv|mov|avi|webm|flv|wmv)$/i.test(ext) || mimeType.startsWith('video/')

    if (!isImage && !isVideo) {
      return null
    }

    // 1. 检查磁盘缓存
    const cacheKey = crypto
      .createHash('sha256')
      .update(`${profileId}:${filePath}:${size}`)
      .digest('hex')
    const cacheFilePath = path.join(this.thumbsDir, `${cacheKey}.jpg`)

    if (fs.existsSync(cacheFilePath)) {
      const cached = await fs.promises.readFile(cacheFilePath)
      return `data:image/jpeg;base64,${cached.toString('base64')}`
    }

    const client = await this.getActiveClient(profileId)
    const normPath = this.normalizeSambaPath(filePath)

    // 2. 图片缩略图提取
    if (isImage) {
      // 策略 A: 若为 JPEG，首先尝试只读前 64KB 解析 EXIF IFD1 缩略图
      if (/\.jpe?g$/i.test(ext)) {
        try {
          const headBytes = await this.readPartialBytes(client, normPath, 65536)
          const thumbBytes = this.extractExifThumb(headBytes)
          if (thumbBytes) {
            await fs.promises.writeFile(cacheFilePath, thumbBytes)
            return `data:image/jpeg;base64,${thumbBytes.toString('base64')}`
          }
        } catch (_) {}
      }

      // 策略 B: 若没有 EXIF 缩略图，且文件小于 4MB，直接读取并用 nativeImage 缩放
      if (size <= 4 * 1024 * 1024) {
        try {
          const fullBuf = await new Promise<Buffer>((resolve, reject) => {
            client.readFile(normPath, (err: any, data: Buffer) => {
              if (err) return reject(err)
              resolve(data)
            })
          })
          const img = nativeImage.createFromBuffer(fullBuf)
          if (!img.isEmpty()) {
            const resized = img.resize({ width: 180, height: 180, quality: 'good' })
            const jpegBuf = resized.toJPEG(80)
            await fs.promises.writeFile(cacheFilePath, jpegBuf)
            return `data:image/jpeg;base64,${jpegBuf.toString('base64')}`
          }
        } catch (_) {}
      }
    }

    // 3. 视频缩略图提取 (读取前 3.5MB 管道传给 FFmpeg)
    if (isVideo) {
      try {
        const ffmpegStatus = await FFmpegManager.getInstance().getStatus()
        if (ffmpegStatus.installed && ffmpegStatus.path) {
          const chunkLen = Math.min(size || 3670016, 3670016) // 3.5MB
          const headBuf = await this.readPartialBytes(client, normPath, chunkLen)
          const frameBuf = await this.extractVideoFrame(ffmpegStatus.path, headBuf)
          if (frameBuf) {
            await fs.promises.writeFile(cacheFilePath, frameBuf)
            return `data:image/jpeg;base64,${frameBuf.toString('base64')}`
          }
        }
      } catch (_) {}
    }

    return null
  }

  // --- 文件流式上传 ---
  public async uploadFile(
    profileId: string,
    localFilePath: string,
    remoteDir: string
  ): Promise<{ success: boolean; error?: string }> {
    const taskId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const fileName = path.basename(localFilePath)

    try {
      if (!fs.existsSync(localFilePath)) {
        return { success: false, error: '本地源文件不存在' }
      }
      const stat = await fs.promises.stat(localFilePath)
      const totalBytes = stat.size
      const client = await this.getActiveClient(profileId)
      const targetPath = this.resolvePath(remoteDir, fileName)

      return new Promise((resolve) => {
        let transferred = 0
        let lastTransferred = 0
        let lastTime = Date.now()

        const readStream = fs.createReadStream(localFilePath)
        const writeStream = client.createWriteStream(targetPath)

        const speedTimer = setInterval(() => {
          const now = Date.now()
          const durationSec = (now - lastTime) / 1000
          if (durationSec > 0.4) {
            const bytesPerSec = (transferred - lastTransferred) / durationSec
            const speed =
              bytesPerSec > 1024 * 1024
                ? `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
                : `${(bytesPerSec / 1024).toFixed(0)} KB/s`

            const progress = totalBytes > 0 ? Math.min(100, (transferred / totalBytes) * 100) : 0
            this.notifyProgress({
              id: taskId,
              type: 'upload',
              fileName,
              transferredBytes: transferred,
              totalBytes,
              progress: Math.round(progress),
              speed,
              status: 'transferring'
            })
            lastTransferred = transferred
            lastTime = now
          }
        }, 500)

        readStream.on('data', (chunk: Buffer) => {
          transferred += chunk.length
        })

        readStream.on('error', (err: any) => {
          clearInterval(speedTimer)
          this.notifyProgress({
            id: taskId,
            type: 'upload',
            fileName,
            transferredBytes: transferred,
            totalBytes,
            progress: 0,
            speed: '0 KB/s',
            status: 'failed',
            error: err.message
          })
          resolve({ success: false, error: err.message })
        })

        writeStream.on('error', (err: any) => {
          clearInterval(speedTimer)
          this.notifyProgress({
            id: taskId,
            type: 'upload',
            fileName,
            transferredBytes: transferred,
            totalBytes,
            progress: 0,
            speed: '0 KB/s',
            status: 'failed',
            error: err.message
          })
          resolve({ success: false, error: err.message })
        })

        writeStream.on('finish', () => {
          clearInterval(speedTimer)
          this.notifyProgress({
            id: taskId,
            type: 'upload',
            fileName,
            transferredBytes: totalBytes,
            totalBytes,
            progress: 100,
            speed: '完成',
            status: 'completed'
          })
          resolve({ success: true })
        })

        readStream.pipe(writeStream)
      })
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  }

  // --- 文件流式下载 ---
  public async downloadFile(
    profileId: string,
    remoteFilePath: string,
    localSavePath?: string
  ): Promise<{ success: boolean; localPath?: string; error?: string }> {
    const taskId = `download_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const fileName = path.basename(remoteFilePath)

    try {
      const client = await this.getActiveClient(profileId)
      const normPath = this.normalizeSambaPath(remoteFilePath)

      const savePath =
        localSavePath || path.join(app.getPath('downloads'), fileName)

      return new Promise((resolve) => {
        let transferred = 0
        let lastTransferred = 0
        let lastTime = Date.now()
        let totalBytes = 0

        client.stat(normPath, (statErr: any, stats: any) => {
          if (!statErr && stats) {
            totalBytes = stats.size || 0
          }

          const readStream = client.createReadStream(normPath)
          const writeStream = fs.createWriteStream(savePath)

          const speedTimer = setInterval(() => {
            const now = Date.now()
            const durationSec = (now - lastTime) / 1000
            if (durationSec > 0.4) {
              const bytesPerSec = (transferred - lastTransferred) / durationSec
              const speed =
                bytesPerSec > 1024 * 1024
                  ? `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
                  : `${(bytesPerSec / 1024).toFixed(0)} KB/s`

              const progress = totalBytes > 0 ? Math.min(100, (transferred / totalBytes) * 100) : 0
              this.notifyProgress({
                id: taskId,
                type: 'download',
                fileName,
                transferredBytes: transferred,
                totalBytes,
                progress: Math.round(progress),
                speed,
                status: 'transferring'
              })
              lastTransferred = transferred
              lastTime = now
            }
          }, 500)

          readStream.on('data', (chunk: Buffer) => {
            transferred += chunk.length
          })

          readStream.on('error', (err: any) => {
            clearInterval(speedTimer)
            this.notifyProgress({
              id: taskId,
              type: 'download',
              fileName,
              transferredBytes: transferred,
              totalBytes,
              progress: 0,
              speed: '0 KB/s',
              status: 'failed',
              error: err.message
            })
            resolve({ success: false, error: err.message })
          })

          writeStream.on('error', (err: any) => {
            clearInterval(speedTimer)
            this.notifyProgress({
              id: taskId,
              type: 'download',
              fileName,
              transferredBytes: transferred,
              totalBytes,
              progress: 0,
              speed: '0 KB/s',
              status: 'failed',
              error: err.message
            })
            resolve({ success: false, error: err.message })
          })

          writeStream.on('finish', () => {
            clearInterval(speedTimer)
            this.notifyProgress({
              id: taskId,
              type: 'download',
              fileName,
              transferredBytes: totalBytes || transferred,
              totalBytes: totalBytes || transferred,
              progress: 100,
              speed: '完成',
              status: 'completed'
            })
            resolve({ success: true, localPath: savePath })
          })

          readStream.pipe(writeStream)
        })
      })
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  }

  // --- 系统原生文件选择对话框 ---
  public async selectLocalFile(): Promise<{
    canceled: boolean
    filePath?: string
    fileName?: string
    size?: number
  }> {
    const res = await dialog.showOpenDialog({
      title: '选择要上传的文件',
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths.length) {
      return { canceled: true }
    }
    const filePath = res.filePaths[0]
    const stat = await fs.promises.stat(filePath)
    return {
      canceled: false,
      filePath,
      fileName: path.basename(filePath),
      size: stat.size
    }
  }

  public async selectLocalDirectory(): Promise<{
    canceled: boolean
    directoryPath?: string
  }> {
    const res = await dialog.showOpenDialog({
      title: '选择下载保存的目标目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths.length) {
      return { canceled: true }
    }
    return {
      canceled: false,
      directoryPath: res.filePaths[0]
    }
  }
}
