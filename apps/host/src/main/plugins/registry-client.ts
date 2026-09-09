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

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/newbee7955/doujiao/main/registry/plugins-registry.json'

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
   * 获取中心市场数据（优先远端 GitHub Raw，自动带本地 fallback）
   */
  public async fetchRegistry(forceRefresh = false): Promise<RegistryData> {
    const now = Date.now()
    if (!forceRefresh && this.cachedRegistry && now - this.lastFetchTime < 60000) {
      return this.cachedRegistry
    }

    // 1. 尝试从网络拉取
    try {
      const resp = await net.fetch(DEFAULT_REGISTRY_URL, {
        headers: { 'User-Agent': 'Doujiao-Host/0.2.0' },
        signal: AbortSignal.timeout(5000)
      })
      if (resp.ok) {
        const data = (await resp.json()) as RegistryData
        this.cachedRegistry = data
        this.lastFetchTime = now
        console.log('[RegistryClient] 成功从远端中心市场同步插件清单')
        return data
      }
    } catch (err) {
      console.warn('[RegistryClient] 远端 Registry 拉取失败，尝试读取本地索引 fallback:', err)
    }

    // 2. 本地 fallback: registry/plugins-registry.json
    const candidates = [
      resolve(app.getAppPath(), '../../registry/plugins-registry.json'),
      resolve(app.getAppPath(), '../registry/plugins-registry.json'),
      resolve(process.cwd(), 'registry/plugins-registry.json')
    ]

    for (const file of candidates) {
      if (existsSync(file)) {
        try {
          const raw = readFileSync(file, 'utf-8')
          const data = JSON.parse(raw) as RegistryData
          this.cachedRegistry = data
          this.lastFetchTime = now
          return data
        } catch (e) {}
      }
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
      resolve(app.getAppPath(), '../../registry/releases', zipFileName),
      resolve(process.cwd(), 'registry/releases', zipFileName)
    ]
    for (const localZip of localReleaseCandidates) {
      if (existsSync(localZip)) {
        const buf = readFileSync(localZip)
        const fs = await import('fs')
        fs.writeFileSync(targetZipPath, buf)
        downloaded = true
        console.log(`[RegistryClient] 检测到本地发布存档，已复用: ${localZip}`)
        break
      }
    }

    if (!downloaded) {
      const resp = await net.fetch(artifact.url)
      if (!resp.ok) {
        throw new Error(`下载插件包失败: HTTP ${resp.status} ${resp.statusText}`)
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
