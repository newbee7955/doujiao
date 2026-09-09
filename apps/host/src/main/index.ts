import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { registerPluginScheme, registerPluginProtocol } from './protocol'
import { setupSecurityGuards } from './security'
import { PluginViewContainerManager } from './container/plugin-view'
import { registerPluginIpcBridge } from './ipc/bridge'
import { registerHostIpc } from './ipc/host-api'
import { ProxyManager } from './network/proxy-manager'

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

  return win
}

app.whenReady().then(async () => {
  // 1. 初始化并应用网络代理策略（默认跟随系统代理，可关闭直连或自定义）
  await ProxyManager.getInstance().init()

  // 2. 在 app ready 之后注册自定义协议处理器 (protocol.handle 依赖默认 session)
  registerPluginProtocol()

  mainWindow = createWindow()

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
