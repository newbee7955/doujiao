import React, { useState, useEffect, useRef } from 'react'
import { renderMarkdown } from './lib/markdown'

interface MarkdownDoc {
  id: string
  title: string
  content: string
  updatedAt: number
}

const DEFAULT_DOCS: MarkdownDoc[] = [
  {
    id: 'welcome-doc',
    title: '欢迎使用 Markdown 编辑器',
    content: `# 欢迎使用 豆角 Markdown 编辑器 📝

这是一个专为**高效写作、文档草稿、技术笔记与快速预览**打造的官方扩展插件。

---

## ✨ 核心特性

- **双栏极速对照**：左侧编辑源码，右侧实时双向渲染
- **丰富语法支持**：支持 GFM 常用语法、代码高亮、表格、任务清单与引用
- **多文档持久化**：内置本地自动保存，防止内容意外丢失
- **导入与导出**：支持本地 \`.md\` 文件导入与一键导出下载

---

## 🛠️ 常用排版演示

### 1. 代码块高亮
\`\`\`typescript
interface PluginContext {
  pluginId: string;
  version: string;
}

export function activate(ctx: PluginContext): void {
  console.log(\`[Plugin] \${ctx.pluginId} v\${ctx.version} 已激活\`);
}
\`\`\`

### 2. 表格展示
| 功能模块 | 运行状态 | 运行环境 |
|---|---|---|
| 应用底座 | 正常运行 | 独立安全环境 |
| 网络代理 | 已就绪 | 统一跟随系统代理 |
| 剪贴板监视 | 监听中 | 本地加密持久化 |

### 3. 任务清单 (Task List)
- [x] 完成应用架构升级
- [x] 支持本地导入导出与全量备份
- [ ] 探索更多生产力拓展插件

> 💡 **提示**：您可以通过顶部工具栏快速插入各种格式，也可以在左侧新建多个独立文档！
`,
    updatedAt: Date.now()
  }
]

export default function App(): JSX.Element {
  const [docs, setDocs] = useState<MarkdownDoc[]>(() => {
    try {
      const saved = localStorage.getItem('doujiao_markdown_docs')
      if (saved) return JSON.parse(saved)
    } catch {}
    return DEFAULT_DOCS
  })

  const [activeDocId, setActiveDocId] = useState<string>(() => docs[0]?.id || 'welcome-doc')
  const [viewMode, setViewMode] = useState<'split' | 'edit' | 'preview'>('split')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  const editorRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeDoc = docs.find((d) => d.id === activeDocId) || docs[0]

  // 本地持久化保存
  useEffect(() => {
    try {
      localStorage.setItem('doujiao_markdown_docs', JSON.stringify(docs))
    } catch (err) {
      console.error('[MarkdownEditor] 保存到本地缓存失败:', err)
    }
  }, [docs])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // 更新当前活动文档内容
  const updateContent = (content: string) => {
    setDocs((prev) =>
      prev.map((d) => (d.id === activeDoc.id ? { ...d, content, updatedAt: Date.now() } : d))
    )
  }

  // 更新标题
  const updateTitle = (title: string) => {
    setDocs((prev) =>
      prev.map((d) => (d.id === activeDoc.id ? { ...d, title, updatedAt: Date.now() } : d))
    )
  }

  // 新建文档
  const handleNewDoc = () => {
    const newDoc: MarkdownDoc = {
      id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: '未命名文档',
      content: '# 新文档\n\n在此开始输入内容...',
      updatedAt: Date.now()
    }
    setDocs((prev) => [newDoc, ...prev])
    setActiveDocId(newDoc.id)
    showToast('已新建空白文档')
  }

  // 删除文档
  const handleDeleteDoc = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (docs.length <= 1) {
      showToast('请至少保留一个文档')
      return
    }
    const filtered = docs.filter((d) => d.id !== id)
    setDocs(filtered)
    if (activeDocId === id) {
      setActiveDocId(filtered[0].id)
    }
    showToast('文档已删除')
  }

  // 工具栏插入语法
  const insertSyntax = (prefix: string, suffix: string = '', defaultPlaceholder: string = '') => {
    const textarea = editorRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const currentText = activeDoc.content
    const selected = currentText.substring(start, end) || defaultPlaceholder

    const replacement = `${prefix}${selected}${suffix}`
    const newContent =
      currentText.substring(0, start) + replacement + currentText.substring(end)

    updateContent(newContent)

    setTimeout(() => {
      textarea.focus()
      const cursorPos = start + prefix.length + selected.length
      textarea.setSelectionRange(cursorPos, cursorPos)
    }, 0)
  }

  // 导出为 .md 文件
  const handleExport = () => {
    const blob = new Blob([activeDoc.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeDoc.title.replace(/[\\/:*?"<>|]/g, '_') || 'document'}.md`
    a.click()
    URL.revokeObjectURL(url)
    showToast('已导出为 Markdown 文件')
  }

  // 导入本地 .md 文件
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = (event.target?.result as string) || ''
      const title = file.name.replace(/\.(md|markdown|txt)$/i, '')
      const newDoc: MarkdownDoc = {
        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title,
        content,
        updatedAt: Date.now()
      }
      setDocs((prev) => [newDoc, ...prev])
      setActiveDocId(newDoc.id)
      showToast(`成功导入文档: ${file.name}`)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // 复制渲染后的纯文本或 Markdown
  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(activeDoc.content).then(() => {
      showToast('Markdown 源码已复制到剪贴板')
    })
  }

  // 统计指标
  const rawContent = activeDoc?.content || ''
  const charCount = rawContent.length
  const wordCount = (rawContent.match(/[\u4e00-\u9fa5]|\b[a-zA-Z0-9_-]+\b/g) || []).length
  const lineCount = rawContent.split(/\r?\n/).length
  const readMinutes = Math.max(1, Math.ceil(wordCount / 300))

  return (
    <div className="h-screen w-screen flex bg-slate-900 text-slate-100 overflow-hidden select-none font-sans">
      {/* 隐藏的导入文件 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* 轻量 Toast 提示 */}
      {toast && (
        <div className="absolute top-4 right-6 z-50 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs shadow-xl shadow-indigo-600/30 flex items-center gap-2 animate-bounce">
          <span>✨</span>
          <span>{toast}</span>
        </div>
      )}

      {/* 左侧文档管理侧边栏 */}
      <div
        className={`bg-slate-950 border-r border-slate-800/80 flex flex-col transition-all duration-300 ${
          sidebarOpen ? 'w-64 min-w-64' : 'w-0 min-w-0 opacity-0 overflow-hidden'
        }`}
      >
        <div className="p-3.5 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📝</span>
            <span className="font-semibold text-xs text-slate-200">我的文档</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
              {docs.length}
            </span>
          </div>
          <button
            onClick={handleNewDoc}
            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs flex items-center gap-1 shadow transition-colors"
          >
            <span>+</span>
            <span>新建</span>
          </button>
        </div>

        {/* 文档列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {docs.map((doc) => {
            const isActive = doc.id === activeDoc.id
            return (
              <div
                key={doc.id}
                onClick={() => setActiveDocId(doc.id)}
                className={`group p-2.5 rounded-xl border text-xs cursor-pointer transition-all flex items-start justify-between ${
                  isActive
                    ? 'bg-indigo-600/15 border-indigo-500/40 text-white shadow-sm'
                    : 'bg-slate-900/40 border-transparent hover:bg-slate-900 hover:border-slate-800 text-slate-400'
                }`}
              >
                <div className="flex-1 overflow-hidden pr-2">
                  <div className="font-medium truncate text-slate-200">{doc.title}</div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1 font-mono">
                    <span>{doc.content.length} 字符</span>
                    <span>•</span>
                    <span>{new Date(doc.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
                {docs.length > 1 && (
                  <button
                    onClick={(e) => handleDeleteDoc(doc.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 text-slate-500 transition-opacity"
                    title="删除此文档"
                  >
                    🗑️
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* 底部导入工具 */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/60">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors"
          >
            <span>📁</span>
            <span>导入本地 .md 文件</span>
          </button>
        </div>
      </div>

      {/* 主编辑工作区 */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-900">
        {/* 顶部标题与控制栏 */}
        <div className="h-14 px-4 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between shrink-0 gap-3">
          <div className="flex items-center gap-2 flex-1 overflow-hidden">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white text-xs border border-slate-800 transition-colors"
              title={sidebarOpen ? '收起文档库' : '展开文档库'}
            >
              {sidebarOpen ? '◀' : '▶'}
            </button>
            <input
              type="text"
              value={activeDoc.title}
              onChange={(e) => updateTitle(e.target.value)}
              className="bg-transparent text-sm font-semibold text-white border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none px-1.5 py-0.5 max-w-sm truncate"
              placeholder="请输入文档标题..."
            />
          </div>

          {/* 视图切换按钮 */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs">
            <button
              onClick={() => setViewMode('edit')}
              className={`px-3 py-1 rounded-lg transition-colors ${
                viewMode === 'edit' ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ✏️ 仅编辑
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`px-3 py-1 rounded-lg transition-colors ${
                viewMode === 'split' ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🌗 双栏对照
            </button>
            <button
              onClick={() => setViewMode('preview')}
              className={`px-3 py-1 rounded-lg transition-colors ${
                viewMode === 'preview' ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              👁️ 仅预览
            </button>
          </div>

          {/* 操作按钮区 */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyMarkdown}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 transition-colors flex items-center gap-1.5"
            >
              <span>📋</span>
              <span>复制源码</span>
            </button>
            <button
              onClick={handleExport}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5"
            >
              <span>💾</span>
              <span>导出文件</span>
            </button>
          </div>
        </div>

        {/* 语法插入快捷工具栏 (在编辑模式或双栏模式可见) */}
        {viewMode !== 'preview' && (
          <div className="px-4 py-2 bg-slate-950/40 border-b border-slate-800/60 flex items-center gap-1 flex-wrap text-xs text-slate-300">
            <button
              onClick={() => insertSyntax('# ', '', '一级标题')}
              className="px-2 py-1 rounded hover:bg-slate-800 font-bold"
              title="一级标题"
            >
              H1
            </button>
            <button
              onClick={() => insertSyntax('## ', '', '二级标题')}
              className="px-2 py-1 rounded hover:bg-slate-800 font-bold"
              title="二级标题"
            >
              H2
            </button>
            <button
              onClick={() => insertSyntax('### ', '', '三级标题')}
              className="px-2 py-1 rounded hover:bg-slate-800 font-bold"
              title="三级标题"
            >
              H3
            </button>
            <span className="text-slate-700 mx-1">|</span>
            <button
              onClick={() => insertSyntax('**', '**', '粗体文字')}
              className="px-2 py-1 rounded hover:bg-slate-800 font-bold"
              title="粗体"
            >
              B
            </button>
            <button
              onClick={() => insertSyntax('*', '*', '斜体文字')}
              className="px-2 py-1 rounded hover:bg-slate-800 italic"
              title="斜体"
            >
              I
            </button>
            <button
              onClick={() => insertSyntax('~~', '~~', '删除线文字')}
              className="px-2 py-1 rounded hover:bg-slate-800 line-through"
              title="删除线"
            >
              S
            </button>
            <span className="text-slate-700 mx-1">|</span>
            <button
              onClick={() => insertSyntax('`', '`', 'code')}
              className="px-2 py-1 rounded hover:bg-slate-800 font-mono text-[11px]"
              title="行内代码"
            >
              `code`
            </button>
            <button
              onClick={() => insertSyntax('```typescript\n', '\n```', '// 代码内容')}
              className="px-2 py-1 rounded hover:bg-slate-800 font-mono text-[11px]"
              title="多行代码块"
            >
              {'{ }'}
            </button>
            <button
              onClick={() => insertSyntax('> ', '', '引用内容')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="引用块"
            >
              “ ”
            </button>
            <span className="text-slate-700 mx-1">|</span>
            <button
              onClick={() => insertSyntax('- ', '', '列表项')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="无序列表"
            >
              • 列表
            </button>
            <button
              onClick={() => insertSyntax('1. ', '', '排序项')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="有序列表"
            >
              1. 列表
            </button>
            <button
              onClick={() => insertSyntax('- [ ] ', '', '待办任务')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="任务清单"
            >
              ☑ 任务
            </button>
            <span className="text-slate-700 mx-1">|</span>
            <button
              onClick={() => insertSyntax('[', '](https://example.com)', '链接文本')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="插入链接"
            >
              🔗 链接
            </button>
            <button
              onClick={() => insertSyntax('![图片描述](', ')', 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="插入图片"
            >
              🖼️ 图片
            </button>
            <button
              onClick={() => insertSyntax('\n| 表头1 | 表头2 |\n|---|---|\n| 内容1 | 内容2 |\n')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="插入表格"
            >
              📊 表格
            </button>
            <button
              onClick={() => insertSyntax('\n---\n')}
              className="px-2 py-1 rounded hover:bg-slate-800"
              title="分割线"
            >
              ➖ 分割线
            </button>
          </div>
        )}

        {/* 编辑与预览核心分栏区 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 编辑器输入区 */}
          {(viewMode === 'split' || viewMode === 'edit') && (
            <div
              className={`flex-1 flex flex-col h-full bg-slate-900 border-r border-slate-800/80 ${
                viewMode === 'split' ? 'w-1/2' : 'w-full'
              }`}
            >
              <textarea
                ref={editorRef}
                value={activeDoc.content}
                onChange={(e) => updateContent(e.target.value)}
                placeholder="在此尽情书写 Markdown 内容..."
                className="flex-1 w-full h-full p-6 bg-transparent resize-none focus:outline-none font-mono text-xs leading-relaxed text-slate-200 placeholder-slate-600 selection:bg-indigo-500/30"
                spellCheck={false}
              />
            </div>
          )}

          {/* 实时渲染预览区 */}
          {(viewMode === 'split' || viewMode === 'preview') && (
            <div
              className={`flex-1 h-full overflow-y-auto p-6 bg-slate-950/60 ${
                viewMode === 'split' ? 'w-1/2' : 'w-full'
              }`}
            >
              <div
                className="max-w-3xl mx-auto prose prose-invert"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(activeDoc.content) }}
              />
            </div>
          )}
        </div>

        {/* 底部状态栏 */}
        <div className="h-7 px-4 bg-slate-950 border-t border-slate-800/80 text-[11px] text-slate-500 flex items-center justify-between font-mono shrink-0">
          <div className="flex items-center gap-4">
            <span>字数: <strong className="text-slate-300">{wordCount}</strong></span>
            <span>字符数: <strong className="text-slate-300">{charCount}</strong></span>
            <span>行数: <strong className="text-slate-300">{lineCount}</strong></span>
            <span>预估阅读: <strong className="text-slate-300">{readMinutes} 分钟</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>自动本地保存已就绪</span>
          </div>
        </div>
      </div>
    </div>
  )
}
