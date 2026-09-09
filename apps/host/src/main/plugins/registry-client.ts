import { app, net } from 'electron'
import { join, resolve } from 'path'
import { existsSync, readFileSync, createWriteStream, mkdirSync } from 'fs'
import semver from 'semver'
import { PluginManager } from './plugin-manager'
import { verifyEd25519Signature, calculateFileSha256 } from '../security/keys'
import type { PluginCapability, PluginEngines } from '@doujiao/plugin-sdk'

export interface RegistryArtifact {
  platform: string
  arch: string
  url: string
  size: number
  sha256: string
  signature: string
}

export interface RegistryRelease {
  version: string
  channel: 'stable' | 'beta'
  publishedAt: string
  changelog: string
  engines: PluginEngines
  permissions: PluginCapability[]
  artifacts: RegistryArtifact[]
}

export interface RegistryPluginItem {
  id: string
  publisher: string
  name: string
  description: string
  icon?: string
  releases: RegistryRelease[]
}

export interface RegistryData {
  schemaVersion: number
  registryVersion: number
  updatedAt: string
  plugins: RegistryPluginItem[]
}

export interface MarketPluginView {
  id: string
  publisher: string
  name: string
  description: string
  icon?: string
  latestVersion: string
  changelog: string
  size: number
  permissions: PluginCapability[]
  isInstalled: boolean
  installedVersion?: string
  hasUpdate: boolean
  isDev?: boolean
}

const REMOTE_REGISTRY_MIRRORS = [
  'https://raw.gitmirror.com/newbee7955/doujiao/main/registry/plugins-registry.json',
  'https://ghproxy.net/https://raw.githubusercontent.com/newbee7955/doujiao/main/registry/plugins-registry.json',
  'https://raw.githubusercontent.com/newbee7955/doujiao/main/registry/plugins-registry.json'
]

export class RegistryClient {
  private static instance: RegistryClient
  private cachedRegistry: RegistryData | null = null
  private lastFetchTime = 0
  private cacheDir: string

  private constructor() {
    this.cacheDir = join(app.getPath('userData'), 'cache', 'plugin-downloads')
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true })
    }
  }

  public static getInstance(): RegistryClient {
    if (!RegistryClient.instance) {
      RegistryClient.instance = new RegistryClient()
    }
    return RegistryClient.instance
  }

  /**
   * 本地索引候选探测（0ms 极速加载）
   */
  private loadLocalRegistry(): RegistryData | null {
    const candidates = [
      resolve(process.cwd(), 'registry/plugins-registry.json'),
      resolve(app.getAppPath(), '../../registry/plugins-registry.json'),
      resolve(app.getAppPath(), '../registry/plugins-registry.json'),
      resolve(app.getAppPath(), 'registry/plugins-registry.json')
    ]

    for (const file of candidates) {
      if (existsSync(file)) {
        try {
          const raw = readFileSync(file, 'utf-8')
          const data = JSON.parse(raw) as RegistryData
          if (data && data.plugins) {
            return data
          }
        } catch {}
      }
    }
    return null
  }

  /**
   * 获取中心市场数据（优先本地极速就绪，支持 CDN 镜像加速同步）
   */
  public async fetchRegistry(forceRefresh = false): Promise<RegistryData> {
    const now = Date.now()
    if (!forceRefresh && this.cachedRegistry && now - this.lastFetchTime < 60000) {
      return this.cachedRegistry
    }

    // 1. 本地极速兜底/开发优先 (0ms 延迟)
    const localData = this.loadLocalRegistry()
    if (localData && !forceRefresh) {
      this.cachedRegistry = localData
      this.lastFetchTime = now
      return localData
    }

    // 2. 尝试从多镜像 CDN 同步最新远端索引 (每个镜像 2.5s 超时)
    for (const mirrorUrl of REMOTE_REGISTRY_MIRRORS) {
      try {
        const resp = await net.fetch(mirrorUrl, {
          headers: { 'User-Agent': 'Doujiao-Host/0.2.0' },
          signal: AbortSignal.timeout(2500)
        })
        if (resp.ok) {
          const data = (await resp.json()) as RegistryData
          if (data && Array.isArray(data.plugins)) {
            this.cachedRegistry = data
            this.lastFetchTime = now
            console.log(`[RegistryClient] Synced registry successfully from mirror: ${mirrorUrl}`)
            return data
          }
        }
      } catch {
        // 继续尝试下一个镜像
      }
    }

    // 3. 远端均不可用时，使用本地已知最新清单
    if (localData) {
      this.cachedRegistry = localData
      this.lastFetchTime = now
      return localData
    }

    return this.cachedRegistry || { schemaVersion: 2, registryVersion: 0, updatedAt: '', plugins: [] }
  }

  /**
   * 获取面向渲染层的市场插件聚合视图（整合本地安装状态与更新提示）
   */
  public async getMarketPlugins(): Promise<MarketPluginView[]> {
    const registry = await this.fetchRegistry()
    const pluginManager = PluginManager.getInstance()
    const installed = pluginManager.listAllPlugins()
    const hostVersion = app.getVersion() || '0.2.0'

    const views: MarketPluginView[] = []

    for (const plugin of registry.plugins) {
      // 筛选与当前宿主版本兼容的最高版本
      const compatibleRelease = plugin.releases.find((r) => {
        if (!r.engines?.doujiao) return true
        return semver.satisfies(hostVersion, r.engines.doujiao, { loose: true })
      }) || plugin.releases[0]

      if (!compatibleRelease) continue

      const local = installed.find((p) => p.id === plugin.id)
      const isInstalled = !!local
      const installedVersion = local?.version
      const latestVersion = compatibleRelease.version
      const hasUpdate = isInstalled && semver.gt(latestVersion, installedVersion || '0.0.0')

      const artifact = compatibleRelease.artifacts?.[0]

      views.push({
        id: plugin.id,
        publisher: plugin.publisher,
        name: plugin.name,
        description: plugin.description,
        icon: plugin.icon,
        latestVersion,
        changelog: compatibleRelease.changelog,
        size: artifact?.size || 0,
        permissions: compatibleRelease.permissions || [],
        isInstalled,
        installedVersion,
        hasUpdate,
        isDev: local?.isDev
      })
    }

    return views
  }

  /**
   * 在线一键下载、双重安全验签（SHA-256 + Ed25519）并事务安装插件
   */
  public async installFromRegistry(pluginId: string, version?: string): Promise<{ success: boolean; pluginId: string; version: string }> {
    const registry = await this.fetchRegistry()
    const plugin = registry.plugins.find((p) => p.id === pluginId)
    if (!plugin) {
      throw new Error(`在插件市场中未找到插件: ${pluginId}`)
    }

    const release = version
      ? plugin.releases.find((r) => r.version === version)
      : plugin.releases[0]

    if (!release) {
      throw new Error(`未找到插件版本: ${pluginId} @ ${version || 'latest'}`)
    }

    const artifact = release.artifacts?.[0]
    if (!artifact) {
      throw new Error(`插件发布信息缺少安装构件 (artifacts)`)
    }

    const zipFileName = `${pluginId}-v${release.version}.zip`
    const targetZipPath = join(this.cacheDir, zipFileName)

    console.log(`\n[RegistryClient] 开始下载插件: ${pluginId}@${release.version}`)
    console.log(`[RegistryClient] 下载来源: ${artifact.url}`)

    // 1. 如果本地开发已有生成好的 release 包，优先使用本地包提速；否则通过网络下载
    let downloaded = false
    const localReleaseCandidates = [
      resolve(process.cwd(), 'registry/releases', zipFileName),
      resolve(app.getAppPath(), '../../registry/releases', zipFileName),
      resolve(app.getAppPath(), '../registry/releases', zipFileName),
      resolve(app.getAppPath(), 'registry/releases', zipFileName)
    ]
    for (const localZip of localReleaseCandidates) {
      if (existsSync(localZip)) {
        const buf = readFileSync(localZip)
        const fs = await import('fs')
        fs.writeFileSync(targetZipPath, buf)
        downloaded = true
        console.log(`[RegistryClient] Using local release archive: ${localZip}`)
        break
      }
    }

    if (!downloaded) {
      const downloadUrls = [
        artifact.url,
        `https://ghproxy.net/${artifact.url}`
      ]
      let resp: any = null
      for (const dUrl of downloadUrls) {
        try {
          resp = await net.fetch(dUrl, { signal: AbortSignal.timeout(15000) })
          if (resp && resp.ok) break
        } catch {}
      }

      if (!resp || !resp.ok) {
        throw new Error(`下载插件包失败: HTTP ${resp?.status || '连接超时'}`)
      }

      const fileStream = createWriteStream(targetZipPath)
      const reader = resp.body?.getReader()
      if (!reader) {
        throw new Error('无法创建网络数据流')
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fileStream.write(Buffer.from(value))
      }
      fileStream.end()

      await new Promise<void>((resolve) => fileStream.on('finish', () => resolve()))
    }

    console.log(`[RegistryClient] 插件包下载完毕，开始双重密码学生命线安全校验...`)

    // 2. 校验文件完整性 (SHA-256)
    const actualSha256 = await calculateFileSha256(targetZipPath)
    if (actualSha256.toLowerCase() !== artifact.sha256.toLowerCase()) {
      throw new Error(
        `[Security] 拦截篡改包：SHA-256 校验失败 (预期: ${artifact.sha256}, 实际: ${actualSha256})`
      )
    }
    console.log(`[RegistryClient] ✓ SHA-256 完整性哈希校验通过`)

    // 3. 校验官方 Ed25519 数字签名
    const isSignatureValid = verifyEd25519Signature(
      Buffer.from(actualSha256, 'utf-8'),
      artifact.signature
    )
    if (!isSignatureValid) {
      throw new Error(`[Security] 拦截非官方或伪造包：Ed25519 数字签名验证未通过！`)
    }
    console.log(`[RegistryClient] ✓ 官方 Ed25519 数字验签通过，证明来源完全可信`)

    // 4. 移交 PluginManager 执行安全解压与不可变事务切换
    const pluginManager = PluginManager.getInstance()
    const result = await pluginManager.installFromZip(targetZipPath)
    console.log(`[RegistryClient] ✓ 插件 ${pluginId}@${release.version} 事务加载完成！`)

    return result
  }
}
