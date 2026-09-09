import React, { useState, useEffect } from 'react'

interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  icon?: string
  publisher?: string
  isDev?: boolean
  isInstalled?: boolean
  enabled?: boolean
  manifest?: any
}

interface MarketPlugin {
  id: string
  publisher: string
  name: string
  description: string
  icon?: string
  latestVersion: string
  changelog: string
  size: number
  permissions: any[]
  isInstalled: boolean
  installedVersion?: string
  hasUpdate: boolean
  isDev?: boolean
}

interface FFmpegStatus {
  installed: boolean
  version?: string
  path?: string
  source?: string
  error?: string
}

interface PermissionDiffModalData {
  pluginId: string
  name: string
  currentVersion: string
  newVersion: string
  changelog: string
  addedCapabilities: string[]
  addedHosts: string[]
}

export default function App(): JSX.Element {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [marketPlugins, setMarketPlugins] = useState<MarketPlugin[]>([])
  const [activeTab, setActiveTab] = useState<string>('douyin-downloader')
  const [tasks, setTasks] = useState<any[]>([])
  const [showTasksDrawer, setShowTasksDrawer] = useState(false)
  const [douyinLoggedIn, setDouyinLoggedIn] = useState(false)
  const [installMsg, setInstallMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [ffmpegStatus, setFFmpegStatus] = useState<FFmpegStatus>({ installed: false })
  const [loadingMarket, setLoadingMarket] = useState(false)
  const [installingPluginId, setInstallingPluginId] = useState<string | null>(null)
  const [ffmpegLoading, setFFmpegLoading] = useState(false)
  const [permissionModal, setPermissionModal] = useState<PermissionDiffModalData | null>(null)

  // 1. 加载本地与已安装插件
  const fetchPlugins = async () => {
    if (window.hostAPI?.listPlugins) {
      const list = await window.hostAPI.listPlugins()
      setPlugins(list || [])
    }
  }

  // 2. 加载远端插件市场聚合清单
  const fetchMarket = async (force = false) => {
    if (window.hostAPI?.fetchMarketPlugins) {
      setLoadingMarket(true)
      try {
        const market = await window.hostAPI.fetchMarketPlugins(force)
        setMarketPlugins(market || [])
      } catch (err: any) {
        console.error('拉取市场清单失败:', err)
      } finally {
        setLoadingMarket(false)
      }
    }
  }

  // 3. 检查 FFmpeg 状态
  const checkFFmpeg = async () => {
    if (window.hostAPI?.getFFmpegStatus) {
      try {
        const res = await window.hostAPI.getFFmpegStatus()
        setFFmpegStatus(res || { installed: false })
      } catch {}
    }
  }

  // 4. 检查抖音登录状态
  const checkDouyinStatus = async () => {
    if (window.hostAPI?.getDouyinStatus) {
      const res = await window.hostAPI.getDouyinStatus()
      setDouyinLoggedIn(res.loggedIn)
    }
  }

  useEffect(() => {
    fetchPlugins()
    fetchMarket()
    checkFFmpeg()
    checkDouyinStatus()
  }, [])

  // 监听 Tab 切换挂载/隐藏沙箱插件
  useEffect(() => {
    if (activeTab !== 'market' && activeTab !== 'settings') {
      window.hostAPI?.showPlugin(activeTab)
    } else {
      window.hostAPI?.hidePlugin()
    }
  }, [activeTab])

  // 定期拉取下载任务列表
  useEffect(() => {
    const fetchTasks = async () => {
      if (window.hostAPI?.listTasks) {
        const list = await window.hostAPI.listTasks()
        setTasks(list || [])
      }
    }
    fetchTasks()
    const interval = setInterval(fetchTasks, 1500)
    return () => clearInterval(interval)
  }, [])

  // 本地安装 ZIP 插件
  const handleInstallZip = async () => {
    if (!window.hostAPI?.installPluginZip) return
    const res = await window.hostAPI.installPluginZip()
    if (res.canceled) return

    if (res.success) {
      setInstallMsg({ text: `插件 ${res.pluginId}@${res.version} 事务安装成功！`, type: 'success' })
      await fetchPlugins()
      await fetchMarket(true)
      if (res.pluginId) {
        setActiveTab(res.pluginId)
      }
    } else {
      setInstallMsg({ text: `安装失败: ${res.error || '未知原因'}`, type: 'error' })
    }
    setTimeout(() => setInstallMsg(null), 5000)
  }

  // 在线市场一键安装
  const handleMarketInstall = async (plugin: MarketPlugin) => {
    if (!window.hostAPI?.installMarketPlugin) return
    setInstallingPluginId(plugin.id)

    try {
      const res = await window.hostAPI.installMarketPlugin(plugin.id, plugin.latestVersion)
      if (res.success) {
        setInstallMsg({
          text: `插件【${plugin.name}】v${plugin.latestVersion} 已通过 Ed25519 双重验签并完成安装！`,
          type: 'success'
        })
        await fetchPlugins()
        await fetchMarket(true)
        setActiveTab(plugin.id)
      } else {
        setInstallMsg({ text: `安装失败: ${res.error || '未知错误'}`, type: 'error' })
      }
    } catch (err: any) {
      setInstallMsg({ text: `安装异常: ${err?.message}`, type: 'error' })
    } finally {
      setInstallingPluginId(null)
      setTimeout(() => setInstallMsg(null), 5000)
    }
  }

  // 检查更新并触发权限变更确认
  const handleTriggerUpdate = async (plugin: MarketPlugin) => {
    if (!window.hostAPI?.checkPluginUpdates) return
    try {
      const updates = await window.hostAPI.checkPluginUpdates()
      const thisUpdate = updates.find((u: any) => u.pluginId === plugin.id)

      if (thisUpdate && thisUpdate.hasPermissionChanges) {
        // 弹出权限变更审计弹窗 (Permission Diff Modal)
        setPermissionModal({
          pluginId: thisUpdate.pluginId,
          name: thisUpdate.name,
          currentVersion: thisUpdate.currentVersion,
          newVersion: thisUpdate.latestVersion,
          changelog: thisUpdate.changelog,
          addedCapabilities: thisUpdate.addedCapabilities || [],
          addedHosts: thisUpdate.addedHosts || []
        })
        return
      }

      // 无敏感权限扩展，直接执行更新
      await executeUpdate(plugin.id, plugin.latestVersion)
    } catch (err: any) {
      setInstallMsg({ text: `更新检查失败: ${err?.message}`, type: 'error' })
    }
  }

  // 用户同意权限后正式执行更新
  const executeUpdate = async (pluginId: string, version: string) => {
    if (!window.hostAPI?.applyPluginUpdate) return
    setInstallingPluginId(pluginId)
    setPermissionModal(null)

    try {
      const res = await window.hostAPI.applyPluginUpdate(pluginId, version)
      if (res.success) {
        setInstallMsg({
          text: `插件 ${pluginId} 已成功升级至 v${version}！`,
          type: 'success'
        })
        await fetchPlugins()
        await fetchMarket(true)
      } else {
        setInstallMsg({ text: `升级失败: ${res.error || '未知错误'}`, type: 'error' })
      }
    } catch (err: any) {
      setInstallMsg({ text: `升级异常: ${err?.message}`, type: 'error' })
    } finally {
      setInstallingPluginId(null)
      setTimeout(() => setInstallMsg(null), 5000)
    }
  }

  // 卸载插件
  const handleUninstall = async (pluginId: string) => {
    if (!window.hostAPI?.uninstallPlugin) return
    const res = await window.hostAPI.uninstallPlugin(pluginId)
    if (res.success) {
      if (activeTab === pluginId) {
        setActiveTab('market')
      }
      await fetchPlugins()
      await fetchMarket(true)
    }
  }

  // FFmpeg 操作
  const handleInstallFFmpeg = async () => {
    if (!window.hostAPI?.installFFmpeg) return
    setFFmpegLoading(true)
    try {
      const res = await window.hostAPI.installFFmpeg()
      if (res.success) {
        setFFmpegStatus(res.status)
        setInstallMsg({ text: 'FFmpeg 独立组件已就绪！', type: 'success' })
      } else {
        setInstallMsg({ text: res.error || 'FFmpeg 安装失败', type: 'error' })
      }
    } catch (err: any) {
      setInstallMsg({ text: err?.message || 'FFmpeg 操作异常', type: 'error' })
    } finally {
      setFFmpegLoading(false)
      setTimeout(() => setInstallMsg(null), 5000)
    }
  }

  const handleSelectFFmpegFile = async () => {
    if (!window.hostAPI?.selectFFmpegFile) return
    const res = await window.hostAPI.selectFFmpegFile()
    if (res.canceled) return

    if (res.success) {
      setFFmpegStatus(res.status)
      setInstallMsg({ text: '成功导入本地 FFmpeg 可执行文件！', type: 'success' })
    } else {
      setInstallMsg({ text: res.error || '导入失败', type: 'error' })
    }
    setTimeout(() => setInstallMsg(null), 5000)
  }

  // 宿主触发抖音扫码登录
  const handleDouyinLogin = async () => {
    if (!window.hostAPI?.loginDouyin) return
    const res = await window.hostAPI.loginDouyin()
    if (res.success) {
      setDouyinLoggedIn(true)
      setInstallMsg({ text: '抖音账号登录成功！', type: 'success' })
    } else {
      setInstallMsg({ text: res.message || '登录未完成', type: 'error' })
    }
    setTimeout(() => setInstallMsg(null), 4000)
  }

  const activeDownloadsCount = tasks.filter((t) => t.status === 'downloading').length

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* 顶部标题栏 (拖拽区) */}
      <header
        className="h-12 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/80 backdrop-blur z-20"
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">🫛</span>
          <span className="font-bold text-sm tracking-wide bg-gradient-to-r from-emerald-400 to-teal-200 bg-clip-text text-transparent">
            豆角工具箱 Doujiao
          </span>
          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 ml-2">
            V2.0 微内核沙箱
          </span>
        </div>

        {/* 右侧控制按钮 */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          {/* 下载托盘按钮 */}
          <button
            onClick={() => setShowTasksDrawer(!showTasksDrawer)}
            className="relative px-3 py-1 mr-2 text-xs rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1.5 transition-colors"
          >
            <span>📥 下载管理</span>
            {activeDownloadsCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            )}
          </button>

          <button
            onClick={() => window.hostAPI?.minimize()}
            className="w-8 h-8 flex items-center justify-center hover:bg-slate-800 text-slate-400 hover:text-white rounded"
          >
            ━
          </button>
          <button
            onClick={() => window.hostAPI?.maximize()}
            className="w-8 h-8 flex items-center justify-center hover:bg-slate-800 text-slate-400 hover:text-white rounded"
          >
            □
          </button>
          <button
            onClick={() => window.hostAPI?.close()}
            className="w-8 h-8 flex items-center justify-center hover:bg-rose-600 text-slate-400 hover:text-white rounded"
          >
            ✕
          </button>
        </div>
      </header>

      {/* 主体双栏布局 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧导航栏 (宽 240px，匹配 WebContentsView 边界) */}
        <aside className="w-60 bg-slate-900 border-r border-slate-800 flex flex-col justify-between p-3 z-10">
          <div className="space-y-1">
            <div className="px-3 py-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
              已安装插件 ({plugins.length})
            </div>

            {plugins.map((plugin) => (
              <button
                key={plugin.id}
                onClick={() => setActiveTab(plugin.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === plugin.id
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <span className="text-base">
                  {plugin.id.includes('douyin') ? '🎵' : plugin.id.includes('bilibili') ? '📺' : '🧩'}
                </span>
                <div className="text-left overflow-hidden">
                  <div className="leading-none truncate">{plugin.name}</div>
                  <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1.5">
                    <span>v{plugin.version}</span>
                    {plugin.isDev ? (
                      <span className="text-amber-400/80">(Dev)</span>
                    ) : (
                      <span className="text-emerald-400/80">(不可变沙箱)</span>
                    )}
                  </div>
                </div>
              </button>
            ))}

            <div className="pt-4 px-3 py-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
              系统中心
            </div>

            <button
              onClick={() => setActiveTab('market')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'market'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span className="text-base">🧩</span>
              <span>插件市场</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'settings'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span className="text-base">⚙️</span>
              <span>宿主设置</span>
            </button>
          </div>

          {/* 底部信息 */}
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-[11px] text-slate-500 space-y-1">
            <div className="flex justify-between">
              <span>微内核机制</span>
              <span className="text-emerald-400 font-mono">Ed25519 验签</span>
            </div>
            <div className="flex justify-between">
              <span>FFmpeg 组件</span>
              <span className={`font-mono ${ffmpegStatus.installed ? 'text-emerald-400' : 'text-amber-400'}`}>
                {ffmpegStatus.installed ? '已就绪' : '未安装'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>活动下载</span>
              <span className="text-slate-300 font-mono">{activeDownloadsCount} 项</span>
            </div>
          </div>
        </aside>

        {/* 右侧内容区 */}
        <main className="flex-1 bg-slate-950 overflow-y-auto p-8">
          {installMsg && (
            <div
              className={`mb-6 p-4 rounded-xl border text-xs flex items-center justify-between shadow-lg ${
                installMsg.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              }`}
            >
              <span>{installMsg.text}</span>
              <button onClick={() => setInstallMsg(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
          )}

          {activeTab === 'market' && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-white">官方插件市场</h1>
                  <p className="text-sm text-slate-400 mt-1">
                    官方签名认证（SHA-256 + Ed25519 双重验签），无特权沙箱隔离运行
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchMarket(true)}
                    disabled={loadingMarket}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition-colors border border-slate-700"
                  >
                    {loadingMarket ? '刷新中...' : '🔄 刷新'}
                  </button>
                  <button
                    onClick={handleInstallZip}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-semibold text-xs transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2"
                  >
                    <span>📦 离线 ZIP 导入</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {marketPlugins.map((plugin) => (
                  <div
                    key={plugin.id}
                    className="p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl">
                            {plugin.id.includes('douyin') ? '🎵' : plugin.id.includes('bilibili') ? '📺' : '🧩'}
                          </span>
                          <div>
                            <h3 className="font-semibold text-white">{plugin.name}</h3>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {plugin.publisher} • 最新 v{plugin.latestVersion}
                              {plugin.size > 0 && ` • ${(plugin.size / 1024).toFixed(0)} KB`}
                            </p>
                          </div>
                        </div>

                        {plugin.hasUpdate ? (
                          <span className="px-2 py-0.5 text-xs rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 animate-pulse">
                            有更新
                          </span>
                        ) : plugin.isInstalled ? (
                          <span className="px-2 py-0.5 text-xs rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            已安装
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-xs rounded bg-slate-800 text-slate-400 border border-slate-700">
                            未安装
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                        {plugin.description}
                      </p>

                      {plugin.changelog && (
                        <div className="mt-2.5 p-2 rounded bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400">
                          <span className="text-slate-500 font-semibold">更新日志：</span>
                          {plugin.changelog}
                        </div>
                      )}

                      {/* 权限提示标签 */}
                      <div className="mt-3 flex flex-wrap gap-1">
                        {plugin.permissions.map((p, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono"
                          >
                            {p.capability}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 font-mono">{plugin.id}</span>
                      <div className="flex items-center gap-2">
                        {plugin.isInstalled && !plugin.hasUpdate && (
                          <button
                            onClick={() => setActiveTab(plugin.id)}
                            className="px-3 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-emerald-400 font-medium transition-colors"
                          >
                            打开
                          </button>
                        )}

                        {plugin.hasUpdate && (
                          <button
                            onClick={() => handleTriggerUpdate(plugin)}
                            disabled={installingPluginId === plugin.id}
                            className="px-3 py-1 text-xs rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold transition-colors shadow-md shadow-amber-500/20"
                          >
                            {installingPluginId === plugin.id ? '更新中...' : '立即更新'}
                          </button>
                        )}

                        {!plugin.isInstalled && (
                          <button
                            onClick={() => handleMarketInstall(plugin)}
                            disabled={installingPluginId === plugin.id}
                            className="px-3.5 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors shadow-md shadow-emerald-600/20"
                          >
                            {installingPluginId === plugin.id ? '安装中...' : '一键安装'}
                          </button>
                        )}

                        {plugin.isInstalled && !plugin.isDev && (
                          <button
                            onClick={() => handleUninstall(plugin.id)}
                            className="px-2.5 py-1 text-xs rounded bg-slate-800/80 hover:bg-rose-500/20 text-rose-400 font-medium transition-colors"
                          >
                            卸载
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-white">宿主设置</h1>
                <p className="text-sm text-slate-400 mt-1">
                  管理微内核底层通用参数、FFmpeg 共享多媒体组件与凭证隔离
                </p>
              </div>

              <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-5">
                {/* FFmpeg 独立组件配置 */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-white flex items-center gap-2">
                        <span>FFmpeg 多媒体独立扩展组件</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                            ffmpegStatus.installed
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          }`}
                        >
                          {ffmpegStatus.installed ? `已就绪 (${ffmpegStatus.source})` : '未安装'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        按需轻量化设计（主程序仅 45MB）。音视频分离流（如 B站 DASH、高清合集）无损合并需此组件。
                      </div>
                      {ffmpegStatus.installed && ffmpegStatus.path && (
                        <div className="text-[11px] text-slate-500 font-mono mt-1 truncate max-w-md">
                          路径: {ffmpegStatus.path} {ffmpegStatus.version ? `(v${ffmpegStatus.version})` : ''}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSelectFFmpegFile}
                        className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                      >
                        手动导入
                      </button>
                      <button
                        onClick={handleInstallFFmpeg}
                        disabled={ffmpegLoading}
                        className="px-3.5 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-md shadow-emerald-600/20 transition-colors"
                      >
                        {ffmpegLoading ? '检测安装中...' : ffmpegStatus.installed ? '重新检测' : '在线安装'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 下载存储 */}
                <div className="border-t border-slate-800 pt-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">统一文件下载存储</div>
                    <div className="text-xs text-slate-400 mt-0.5">所有沙箱插件推入的任务均统一保存在宿主集中目录</div>
                  </div>
                  <button
                    onClick={() => window.hostAPI?.openDownloadDir()}
                    className="px-3.5 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                  >
                    打开目录
                  </button>
                </div>

                {/* 抖音凭证 */}
                <div className="border-t border-slate-800 pt-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">抖音网页端隔离会话</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {douyinLoggedIn ? (
                        <span className="text-emerald-400">✓ 已捕获有效凭证（自动附加安全 ttwid，插件无法获取明文 Cookie）</span>
                      ) : (
                        <span className="text-amber-400">未检测到登录凭证，部分高清视频与合集可能受限</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleDouyinLogin}
                    className="px-3.5 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 transition-colors"
                  >
                    {douyinLoggedIn ? '重新登录' : '扫码登录'}
                  </button>
                </div>

                {/* 沙箱安全 */}
                <div className="border-t border-slate-800 pt-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">微内核安全架构基线</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      强制 WebContentsView 进程隔离、CSP 脚本阻断、Ed25519 签名与不可变目录版本指针
                    </div>
                  </div>
                  <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    双重密码学保护中
                  </span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 权限变更差异审计确认弹窗 (Permission Diff Modal) */}
      {permissionModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🛡️</span>
              <div>
                <h3 className="font-bold text-white text-base">插件权限变更审计确认</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  插件【{permissionModal.name}】正在申请扩展运行权限
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs leading-relaxed space-y-2">
              <p className="font-semibold flex items-center gap-1.5">
                <span>⚠️</span>
                <span>检测到该版本申请了新的权限能力：</span>
              </p>

              {permissionModal.addedCapabilities.length > 0 && (
                <div>
                  <span className="text-slate-400">新增系统能力: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {permissionModal.addedCapabilities.map((cap, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-amber-500/20 font-mono text-[11px] text-amber-200">
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {permissionModal.addedHosts.length > 0 && (
                <div>
                  <span className="text-slate-400">新增网络请求域名: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {permissionModal.addedHosts.map((host, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-amber-500/20 font-mono text-[11px] text-amber-200">
                        {host}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-400 pt-1">
                版本跨度: v{permissionModal.currentVersion} → v{permissionModal.newVersion}
              </p>
            </div>

            <div className="text-xs text-slate-400">
              更新日志: {permissionModal.changelog}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setPermissionModal(null)}
                className="px-4 py-2 rounded-xl text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                暂不升级
              </button>
              <button
                onClick={() => executeUpdate(permissionModal.pluginId, permissionModal.newVersion)}
                className="px-4 py-2 rounded-xl text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold shadow-lg shadow-amber-500/20 transition-all"
              >
                同意授权并升级
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 集中式下载任务抽屉 (悬浮窗口) */}
      {showTasksDrawer && (
        <div className="fixed right-0 top-12 bottom-0 w-96 bg-slate-900 border-l border-slate-800 shadow-2xl z-30 flex flex-col">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div className="font-semibold text-sm text-white flex items-center gap-2">
              <span>📥 下载任务列表</span>
              <span className="text-xs text-slate-400 font-mono">({tasks.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => window.hostAPI?.openDownloadDir()}
                className="text-xs text-emerald-400 hover:underline"
              >
                打开文件夹
              </button>
              <button
                onClick={() => setShowTasksDrawer(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {tasks.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-xs text-slate-500">
                暂无下载任务
              </div>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-1.5"
                >
                  <div className="font-medium text-slate-200 truncate" title={task.filename}>
                    {task.filename}
                  </div>
                  <div className="flex items-center justify-between text-slate-400 text-[11px]">
                    <span>
                      {task.status === 'completed'
                        ? '已完成'
                        : task.status === 'merging'
                        ? '音视频混流中...'
                        : task.status === 'downloading'
                        ? `${task.speed}`
                        : task.status === 'failed'
                        ? `失败: ${task.error || ''}`
                        : '等待中'}
                    </span>
                    <span className="font-mono">{task.progress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        task.status === 'completed'
                          ? 'bg-emerald-500'
                          : task.status === 'merging'
                          ? 'bg-amber-400 animate-pulse'
                          : task.status === 'failed'
                          ? 'bg-rose-500'
                          : 'bg-indigo-500'
                      }`}
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

