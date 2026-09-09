import React, { useState, useEffect, useMemo } from 'react'

interface Note {
  id: string
  title: string
  content: string
  pinned: boolean
  updatedAt: number
  color?: string
}

const DEFAULT_NOTES: Note[] = [
  {
    id: 'note-welcome',
    title: '随手记便签使用指南',
    content: `欢迎使用 豆角轻便记事本！🗒️

这是一款随时随地记录灵感、临时备忘、代办事项与文本片段的随手记工具。

💡 特性提示：
1. 实时自动保存：键入即保存在本地，无需担心关闭后内容丢失。
2. 置顶功能：点击右上角的图钉 📌 可以将高频使用的便签置顶在列表顶端。
3. 搜索与导出：支持标题与正文关键词极速搜索，支持一键导出为 .txt 文件。
4. 字号与字体切换：可以在顶部切换舒适的文字大小与行距。`,
    pinned: true,
    updatedAt: Date.now(),
    color: 'amber'
  }
]

export default function App(): JSX.Element {
  const [notes, setNotes] = useState<Note[]>(() => {
    try {
      const saved = localStorage.getItem('doujiao_notepad_notes')
      if (saved) return JSON.parse(saved)
    } catch {}
    return DEFAULT_NOTES
  })

  const [activeNoteId, setActiveNoteId] = useState<string>(() => notes[0]?.id || 'note-welcome')
  const [searchQuery, setSearchQuery] = useState('')
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base')
  const [fontFamily, setFontFamily] = useState<'sans' | 'mono'>('sans')
  const [toast, setToast] = useState<string | null>(null)

  const activeNote = notes.find((n) => n.id === activeNoteId) || notes[0]

  // 本地自动保存
  useEffect(() => {
    try {
      localStorage.setItem('doujiao_notepad_notes', JSON.stringify(notes))
    } catch (err) {
      console.error('[Notepad] 自动保存失败:', err)
    }
  }, [notes])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // 过滤笔记
  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return [...notes]
      .filter((n) => {
        if (!q) return true
        return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.updatedAt - a.updatedAt
      })
  }, [notes, searchQuery])

  // 新建笔记
  const handleNewNote = () => {
    const newNote: Note = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: '新便签',
      content: '',
      pinned: false,
      updatedAt: Date.now()
    }
    setNotes((prev) => [newNote, ...prev])
    setActiveNoteId(newNote.id)
    showToast('已新建空白便签')
  }

  // 更新内容
  const updateNote = (field: 'title' | 'content', val: string) => {
    setNotes((prev) =>
      prev.map((n) => {
        if (n.id === activeNote.id) {
          return {
            ...n,
            [field]: val,
            updatedAt: Date.now()
          }
        }
        return n
      })
    )
  }

  // 切换置顶
  const togglePin = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, pinned: !n.pinned, updatedAt: Date.now() } : n))
    )
    showToast('已更新便签置顶状态')
  }

  // 删除便签
  const handleDelete = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (notes.length <= 1) {
      showToast('请至少保留一个便签')
      return
    }
    const remaining = notes.filter((n) => n.id !== id)
    setNotes(remaining)
    if (activeNoteId === id) {
      setActiveNoteId(remaining[0].id)
    }
    showToast('便签已删除')
  }

  // 复制内容
  const handleCopy = () => {
    if (!activeNote?.content) {
      showToast('当前便签为空，无需复制')
      return
    }
    navigator.clipboard.writeText(activeNote.content).then(() => {
      showToast('内容已复制到系统剪贴板')
    })
  }

  // 导出为 .txt
  const handleExportTxt = () => {
    const blob = new Blob([activeNote.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeNote.title.replace(/[\\/:*?"<>|]/g, '_') || 'note'}.txt`
    a.click()
    URL.revokeObjectURL(url)
    showToast('已导出为 TXT 文件')
  }

  // 清空当前内容
  const handleClear = () => {
    if (!activeNote.content) return
    updateNote('content', '')
    showToast('已清空当前便签内容')
  }

  // 字数统计
  const text = activeNote?.content || ''
  const charCount = text.length
  const wordCount = (text.match(/[\u4e00-\u9fa5]|\b[a-zA-Z0-9_-]+\b/g) || []).length
  const lineCount = text ? text.split(/\r?\n/).length : 0

  return (
    <div className="h-screen w-screen flex bg-slate-900 text-slate-100 overflow-hidden select-none font-sans">
      {/* 轻量提示 */}
      {toast && (
        <div className="absolute top-4 right-6 z-50 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs shadow-xl shadow-amber-600/30 flex items-center gap-2 animate-bounce">
          <span>🗒️</span>
          <span>{toast}</span>
        </div>
      )}

      {/* 左侧便签列表 */}
      <div className="w-72 min-w-72 bg-slate-950 border-r border-slate-800/80 flex flex-col h-full">
        {/* 标题栏与新建按钮 */}
        <div className="p-3.5 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🗒️</span>
            <div>
              <span className="font-semibold text-xs text-slate-200">轻便记事本</span>
              <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                {notes.length} 条
              </span>
            </div>
          </div>
          <button
            onClick={handleNewNote}
            className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs flex items-center gap-1 shadow transition-colors font-medium"
          >
            <span>+</span>
            <span>新建</span>
          </button>
        </div>

        {/* 搜索框 */}
        <div className="p-2.5 border-b border-slate-800/60">
          <div className="relative flex items-center">
            <span className="absolute left-3 text-slate-500 text-xs">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索便签标题或正文..."
              className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 text-slate-500 hover:text-slate-300 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* 便签卡片列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {filteredNotes.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">未搜索到相关便签</div>
          ) : (
            filteredNotes.map((note) => {
              const isActive = note.id === activeNote.id
              const previewText = note.content.trim().slice(0, 50) || '无额外正文...'
              return (
                <div
                  key={note.id}
                  onClick={() => setActiveNoteId(note.id)}
                  className={`group p-3 rounded-xl border text-xs cursor-pointer transition-all relative ${
                    isActive
                      ? 'bg-amber-500/15 border-amber-500/40 text-white shadow-sm'
                      : 'bg-slate-900/40 border-slate-800/40 hover:bg-slate-900 hover:border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      {note.pinned && <span className="text-amber-400 text-xs">📌</span>}
                      <span className="font-semibold truncate text-slate-200">{note.title}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => togglePin(note.id, e)}
                        className={`p-1 hover:text-amber-400 ${note.pinned ? 'text-amber-400' : 'text-slate-500'}`}
                        title={note.pinned ? '取消置顶' : '置顶便签'}
                      >
                        📌
                      </button>
                      {notes.length > 1 && (
                        <button
                          onClick={(e) => handleDelete(note.id, e)}
                          className="p-1 hover:text-rose-400 text-slate-500"
                          title="删除便签"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                    {previewText}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-slate-600 mt-2 font-mono">
                    <span>{note.content.length} 字符</span>
                    <span>{new Date(note.updatedAt).toLocaleDateString([], { month: '2-digit', day: '2-digit' })} {new Date(note.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* 右侧主编辑器 */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-900">
        {/* 顶部控制栏 */}
        <div className="h-14 px-5 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between shrink-0 gap-3">
          <input
            type="text"
            value={activeNote.title}
            onChange={(e) => updateNote('title', e.target.value)}
            className="bg-transparent text-base font-semibold text-white border-b border-transparent hover:border-slate-700 focus:border-amber-500 focus:outline-none px-1.5 py-0.5 max-w-md truncate"
            placeholder="输入便签标题..."
          />

          <div className="flex items-center gap-2">
            {/* 字号切换 */}
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs">
              <button
                onClick={() => setFontSize('sm')}
                className={`px-2 py-0.5 rounded ${fontSize === 'sm' ? 'bg-amber-600 text-white' : 'text-slate-400'}`}
                title="小字号"
              >
                A-
              </button>
              <button
                onClick={() => setFontSize('base')}
                className={`px-2 py-0.5 rounded ${fontSize === 'base' ? 'bg-amber-600 text-white' : 'text-slate-400'}`}
                title="标准字号"
              >
                A
              </button>
              <button
                onClick={() => setFontSize('lg')}
                className={`px-2 py-0.5 rounded ${fontSize === 'lg' ? 'bg-amber-600 text-white' : 'text-slate-400'}`}
                title="大字号"
              >
                A+
              </button>
            </div>

            {/* 字体切换 */}
            <button
              onClick={() => setFontFamily((prev) => (prev === 'sans' ? 'mono' : 'sans'))}
              className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 font-mono"
              title="切换等宽/无衬线字体"
            >
              {fontFamily === 'mono' ? '等宽' : '标准'}
            </button>

            {/* 置顶按钮 */}
            <button
              onClick={() => togglePin(activeNote.id)}
              className={`px-3 py-1.5 rounded-xl border text-xs flex items-center gap-1 transition-colors ${
                activeNote.pinned
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <span>📌</span>
              <span>{activeNote.pinned ? '已置顶' : '置顶'}</span>
            </button>

            {/* 复制 */}
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 transition-colors flex items-center gap-1.5"
              title="复制全部内容"
            >
              <span>📋</span>
              <span>复制</span>
            </button>

            {/* 导出 */}
            <button
              onClick={handleExportTxt}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-semibold shadow-md shadow-amber-600/20 transition-all flex items-center gap-1.5"
              title="导出为 txt"
            >
              <span>💾</span>
              <span>导出</span>
            </button>

            {/* 清空 */}
            <button
              onClick={handleClear}
              className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-rose-900/30 border border-slate-800 hover:border-rose-800/50 text-xs text-slate-500 hover:text-rose-400 transition-colors"
              title="清空当前内容"
            >
              🧹
            </button>
          </div>
        </div>

        {/* 核心文本编辑区 */}
        <div className="flex-1 p-6 overflow-hidden">
          <textarea
            value={activeNote.content}
            onChange={(e) => updateNote('content', e.target.value)}
            placeholder="随时记录你的灵感、备忘、代办事项或临时草稿..."
            className={`w-full h-full bg-transparent resize-none focus:outline-none leading-relaxed text-slate-100 placeholder-slate-600 selection:bg-amber-500/30 ${
              fontFamily === 'mono' ? 'font-mono' : 'font-sans'
            } ${
              fontSize === 'sm'
                ? 'text-xs'
                : fontSize === 'base'
                ? 'text-sm'
                : 'text-base leading-loose'
            }`}
            spellCheck={false}
          />
        </div>

        {/* 底部状态栏 */}
        <div className="h-7 px-5 bg-slate-950 border-t border-slate-800/80 text-[11px] text-slate-500 flex items-center justify-between font-mono shrink-0">
          <div className="flex items-center gap-4">
            <span>字数: <strong className="text-slate-300">{wordCount}</strong></span>
            <span>字符数: <strong className="text-slate-300">{charCount}</strong></span>
            <span>行数: <strong className="text-slate-300">{lineCount}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            <span>实时输入即存</span>
          </div>
        </div>
      </div>
    </div>
  )
}
