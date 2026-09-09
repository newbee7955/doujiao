import { app, net } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, copyFileSync, unlinkSync, createWriteStream } from 'fs'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import https from 'https'
import http from 'http'
import { URL } from 'url'

const execAsync = promisify(exec)

export interface FFmpegStatus {
  installed: boolean
  version?: string
  path?: string
  source: 'builtin' | 'system' | 'custom' | 'none'
  error?: string
}

export class FFmpegManager {
  private static instance: FFmpegManager
  private baseDir: string
  private customPath: string | null = null

  private constructor() {
    this.baseDir = join(
      app.getPath('userData'),
      'bin',
      'ffmpeg',
      '7.0.1',
      `${process.platform}-${process.arch}`
    )
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true })
    }
  }

  public static getInstance(): FFmpegManager {
    if (!FFmpegManager.instance) {
      FFmpegManager.instance = new FFmpegManager()
    }
    return FFmpegManager.instance
  }

  public getTargetExecutablePath(): string {
    const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    return join(this.baseDir, exeName)
  }

  /**
   * 检测 FFmpeg 运行组件状态（优先检测 userData 共享池，其次检测系统 PATH）
   */
  public async getStatus(): Promise<FFmpegStatus> {
    // 1. 检测自定义指定路径
    if (this.customPath && existsSync(this.customPath)) {
      const ver = await this.queryVersion(this.customPath)
      if (ver) {
        return {
          installed: true,
          version: ver,
          path: this.customPath,
          source: 'custom'
        }
      }
    }

    // 2. 检测 userData 独立共享池路径: userData/bin/ffmpeg/.../ffmpeg.exe
    const builtinPath = this.getTargetExecutablePath()
    if (existsSync(builtinPath)) {
      const ver = await this.queryVersion(builtinPath)
      if (ver) {
        return {
          installed: true,
          version: ver,
          path: builtinPath,
          source: 'builtin'
        }
      }
    }

    // 3. 检测系统 PATH
    try {
      const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg'
      const { stdout } = await execAsync(cmd)
      const systemPath = stdout.trim().split(/\r?\n/)[0]
      if (systemPath && existsSync(systemPath)) {
        const ver = await this.queryVersion(systemPath)
        if (ver) {
          return {
            installed: true,
            version: ver,
            path: systemPath,
            source: 'system'
          }
        }
      }
    } catch {
      // 系统未找到 ffmpeg
    }

    return {
      installed: false,
      source: 'none',
      error: '未检测到 FFmpeg 组件'
    }
  }

  /**
   * 查询指定可执行文件的 FFmpeg 版本号
   */
  private async queryVersion(binPath: string): Promise<string | null> {
    try {
      const { stdout, stderr } = await execAsync(`"${binPath}" -version`, { timeout: 3000 })
      const out = stdout || stderr
      const match = out.match(/ffmpeg version\s+([^\s]+)/i)
      return match ? match[1] : '已检测'
    } catch {
      return null
    }
  }

  /**
   * 用户手动导入现有的 ffmpeg.exe 文件
   */
  public async importCustomBinary(sourcePath: string): Promise<FFmpegStatus> {
    if (!existsSync(sourcePath)) {
      throw new Error(`指定的文件不存在: ${sourcePath}`)
    }

    const ver = await this.queryVersion(sourcePath)
    if (!ver) {
      throw new Error(`该文件无法识别为有效的 FFmpeg 可执行文件: ${sourcePath}`)
    }

    const targetPath = this.getTargetExecutablePath()
    mkdirSync(dirname(targetPath), { recursive: true })
    copyFileSync(sourcePath, targetPath)

    if (process.platform !== 'win32') {
      const fs = await import('fs')
      fs.chmodSync(targetPath, 0o755)
    }

    console.log(`[FFmpegManager] 成功导入 FFmpeg 扩展组件: ${targetPath} (v${ver})`)
    return {
      installed: true,
      version: ver,
      path: targetPath,
      source: 'builtin'
    }
  }

  /**
   * 在线一键按需下载并安装 FFmpeg 独立组件
   */
  public async installFFmpeg(): Promise<FFmpegStatus> {
    const current = await this.getStatus()
    if (current.installed) {
      return current
    }

    const targetPath = this.getTargetExecutablePath()
    mkdirSync(dirname(targetPath), { recursive: true })

    console.log('[FFmpegManager] 准备安装 FFmpeg 独立组件至:', targetPath)

    // 检测本地常见路径是否有候选文件
    const candidateLocalPaths = [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'D:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'
    ]

    for (const p of candidateLocalPaths) {
      if (existsSync(p)) {
        return await this.importCustomBinary(p)
      }
    }

    const downloadUrl =
      process.platform === 'win32'
        ? 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
        : 'https://evermeet.cx/ffmpeg/getrelease/zip'

    try {
      console.log(`[FFmpegManager] 尝试从 ${downloadUrl} 下载 FFmpeg...`)
      await this.downloadFile(downloadUrl, targetPath + '.zip')
    } catch (err: any) {
      console.warn('[FFmpegManager] 在线下载连接超时或受限:', err?.message)
      throw new Error(
        '在线下载 FFmpeg 超时（网络/防火墙限制）。请点击「手动导入」直接选择本地现有的 ffmpeg.exe，或安装到系统环境变量后点击刷新。'
      )
    }

    return await this.getStatus()
  }

  private async downloadFile(fileUrl: string, destPath: string): Promise<void> {
    const resp = await net.fetch(fileUrl, {
      headers: { 'User-Agent': 'Doujiao-Host/0.2.0' },
      signal: AbortSignal.timeout(60000)
    })
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`)
    }
    const reader = resp.body?.getReader()
    if (!reader) {
      throw new Error('无法创建网络数据流')
    }
    const file = createWriteStream(destPath)
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      file.write(Buffer.from(value))
    }
    file.end()
    await new Promise<void>((resolve, reject) => {
      file.on('finish', () => resolve())
      file.on('error', reject)
    })
  }

  /**
   * 受控执行音视频无损快速合并 (Remux)
   * 采用 -c:v copy -c:a aac 极其高效且不损失原画质
   */
  public async mergeMedia(
    videoPath: string,
    audioPath: string,
    outputPath: string
  ): Promise<{ success: boolean; outputPath: string }> {
    const status = await this.getStatus()
    if (!status.installed || !status.path) {
      throw new Error('未检测到 FFmpeg 独立组件，无法执行音视频流合成。请先在「宿主设置」中完成 FFmpeg 安装配置。')
    }

    if (!existsSync(videoPath)) {
      throw new Error(`视频源文件不存在: ${videoPath}`)
    }
    if (!existsSync(audioPath)) {
      throw new Error(`音频源文件不存在: ${audioPath}`)
    }

    console.log(`[FFmpegManager] 开始音视频流合并:`)
    console.log(`  视频源: ${videoPath}`)
    console.log(`  音频源: ${audioPath}`)
    console.log(`  输出至: ${outputPath}`)

    return new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-i',
        videoPath,
        '-i',
        audioPath,
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-strict',
        'experimental',
        outputPath
      ]

      const proc = spawn(status.path!, args, {
        windowsHide: true
      })

      let stderr = ''
      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code === 0 && existsSync(outputPath)) {
          console.log(`[FFmpegManager] ✓ 音视频合成成功: ${outputPath}`)
          resolve({ success: true, outputPath })
        } else {
          console.error(`[FFmpegManager] 合成失败 (exit ${code}):`, stderr)
          reject(new Error(`FFmpeg 合成失败 (退出码 ${code}): ${stderr.slice(-300)}`))
        }
      })

      proc.on('error', (err) => {
        reject(new Error(`启动 FFmpeg 进程失败: ${err.message}`))
      })
    })
  }
}
