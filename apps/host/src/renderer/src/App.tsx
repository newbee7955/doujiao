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
}

export default function App(): JSX.Element {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [activeTab, setActiveTab] = useState<string>('douyin-downloader')
  const [tasks, setTasks] = useState<any[]>([])
  const [showTasksDrawer, setShowTasksDrawer] = useState(false)
  const [douyinLoggedIn, setDouyinLoggedIn] = useState(false)
  const [installMsg, setInstallMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // 加载插件列表
  const fetchPlugins = async () => {
    if (window.hostAPI?.listPlugins) {
      const list = await window.hostAPI.listPlugins()
      setPlugins(list || [])
    }
  }

  // 检查抖音登录状态
  const checkDouyinStatus = async () => {
    if (window.hostAPI?.getDouyinStatus) {
      const res = await window.hostAPI.getDouyinStatus()
      setDouyinLoggedIn(res.loggedIn)
    }
  }

  useEffect(() => {
    fetchPlugins()
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
      if (res.pluginId) {
        setActiveTab(res.pluginId)
      }
    } else {
      setInstallMsg({ text: `安装失败: ${res.error || '未知原因'}`, type: 'error' })
    }
    setTimeout(() => setInstallMsg(null), 5000)
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
    }
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
                <span className="text-base">{plugin.id.includes('douyin') ? '🎵' : '🧩'}</span>
                <div className="text-left overflow-hidden">
                  <div className="leading-none truncate">{plugin.name}</div>
                  <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1.5">
                    <span>v{plugin.version}</span>
                    {plugin.isDev ? (
                      <span className="text-amber-400/80">(Dev)</span>
                    ) : (
                      <span className="text-emerald-400/80">(沙箱)</span>
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
              <span>微内核状态</span>
              <span className="text-emerald-400 font-mono">就绪 (V2.0)</span>
            </div>
            <div className="flex justify-between">
              <span>活动下载</span>
              <span className="text-slate-300 font-mono">{activeDownloadsCount} 项</span>
            </div>
          </div>
        </aside>

        {/* 右侧内容区：
            当 activeTab 为插件 ID 时，WebContentsView 会覆盖在右侧区域上方；
            当切回 market 或 settings 时，WebContentsView 自动移除，显示宿主页面 */}
        <main className="flex-1 bg-slate-950 overflow-y-auto p-8">
          {installMsg && (
            <div
              className={`mb-6 p-4 rounded-xl border text-xs flex items-center justify-between ${
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
                  <h1 className="text-2xl font-bold text-white">插件市场</h1>
                  <p className="text-sm text-slate-400 mt-1">按需安装官方认证或不可变本地插件包，即装即用</p>
                </div>
                <button
                  onClick={handleInstallZip}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-semibold text-xs transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2"
                >
                  <span>📦 安装本地插件 (ZIP)</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* 动态显示已安装插件 */}
                {plugins.map((plugin) => (
                  <div
                    key={plugin.id}
                    className="p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl">{plugin.id.includes('douyin') ? '🎵' : '🧩'}</span>
                          <div>
                            <h3 className="font-semibold text-white">{plugin.name}</h3>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {plugin.publisher || '官方认证'} • v{plugin.version}
                            </p>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 text-xs rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {plugin.isDev ? '开发中' : '已就绪'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                        {plugin.description}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 font-mono">ID: {plugin.id}</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setActiveTab(plugin.id)}
                          className="px-3 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-emerald-400 font-medium transition-colors"
                        >
                          打开
                        </button>
                        {!plugin.isDev && (
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

                {/* B站占位卡片 (演示多插件体系) */}
                {!plugins.some((p) => p.id === 'bilibili-downloader') && (
                  <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800/60 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl opacity-80">📺</span>
                          <div>
                            <h3 className="font-semibold text-slate-300">B站视频下载器</h3>
                            <p className="text-xs text-slate-500 mt-0.5">官方插件 • v1.0.5 • 150 KB</p>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 text-xs rounded bg-slate-800 text-slate-400">
                          未安装
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-3 leading-relaxed">
                        支持 B 站高清视频、多 P 连载选集、高码率画质提取与自动音视频流合成。
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 font-mono">ID: bilibili-downloader</span>
                      <span className="text-xs text-slate-500">可通过 ZIP 导入</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-white">宿主设置</h1>
                <p className="text-sm text-slate-400 mt-1">管理微内核底层通用参数、账号凭证与安全基线</p>
              </div>

              <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-5">
                {/* 下载存储 */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">统一文件下载存储</div>
                    <div className="text-xs text-slate-400 mt-0.5">插件提交的所有视频与文件的默认落地目录</div>
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
                    <div className="text-sm font-medium text-white">抖音网页端账号状态</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {douyinLoggedIn ? (
                        <span className="text-emerald-400">✓ 已捕获有效登录凭证 (解除搜索与主页 2483 限制)</span>
                      ) : (
                        <span className="text-amber-400">未检测到登录，可能触发部分合集与用户搜索风控</span>
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
                    <div className="text-sm font-medium text-white">沙箱强化隔离机制</div>
                    <div className="text-xs text-slate-400 mt-0.5">严格隔离 Node.js 特权与原生系统调用，保障微内核安全性</div>
                  </div>
                  <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    已强制开启
                  </span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

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
