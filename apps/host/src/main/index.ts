import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { registerPluginScheme, registerPluginProtocol } from './protocol'
import { setupSecurityGuards } from './security'
import { PluginViewContainerManager } from './container/plugin-view'
import { registerPluginIpcBridge } from './ipc/bridge'
import { registerHostIpc } from './ipc/host-api'
import { ProxyManager } from './network/proxy-manager'

// 0. 单实例互斥锁：防止多开冲突及底层 Chromium GPU/Disk Cache 文件锁定冲突 (0x5 ACCESS_DENIED)
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  console.log('[Host] 检测到已有实例正在运行，自动退出当前重复进程并唤醒主窗口')
  app.quit()
  process.exit(0)
}

// 1. 必须在 app ready 之前声明自定义协议特权
registerPluginScheme()

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f172a',
    webPreferences: {
      sandbox: true,               // 加固：开启沙箱
      contextIsolation: true,      // 加固：上下文隔离
      nodeIntegration: false,      // 禁用 Node 原生直接注入
      preload: join(__dirname, '../preload/index.cjs'),
      webSecurity: true,
      spellcheck: false
    }
  })

  // 挂载主窗口安全拦截
  setupSecurityGuards(win.webContents, false)

  win.on('ready-to-show', () => {
    win.show()
  })

  // 初始化插件沙箱容器与 IPC
  const containerManager = PluginViewContainerManager.getInstance()
  containerManager.init(win)

  registerHostIpc(win)
  registerPluginIpcBridge()

  // 加载宿主 Shell 界面
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    containerManager.destroyAll()
    mainWindow = null
  })

  return win
}

app.whenReady().then(async () => {
  // 1. 初始化并应用网络代理策略（默认跟随系统代理，可关闭直连或自定义）
  await ProxyManager.getInstance().init()

  // 2. 在 app ready 之后注册自定义协议处理器 (protocol.handle 依赖默认 session)
  registerPluginProtocol()

  mainWindow = createWindow()

  // 监听多开事件，唤醒现有主窗口
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  PluginViewContainerManager.getInstance().destroyAll()
})
