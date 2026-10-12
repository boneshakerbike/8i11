'use client'

/**
 * COROS MCP connection test (Phase 0, docs/health-roadmap.md).
 * Connect, run a 7-day read-only sample, and copy the raw output.
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import NavTabs from '@/components/nav_tabs'

interface Status {
  connected: boolean
  registered: boolean
  origin: string
  server_url: string
  read_tools: string[]
}

const btn = 'text-sm px-3 py-2 rounded border border-white/15 hover:border-cyan-400/40 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed'

function CorosMcpContent() {
  const params = useSearchParams()
  const url_error = params.get('error')
  const just_connected = params.get('connected') === '1'

  const [status, setStatus] = useState<Status | null>(null)
  const [status_error, setStatusError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState('')
  const [tool, setTool] = useState('querySleepData')
  const [args_text, setArgsText] = useState('{}')
  const [copied, setCopied] = useState(false)

  const load_status = useCallback(async () => {
    const res = await fetch('/api/coros/mcp')
    const data = await res.json()
    if (!res.ok) setStatusError(data.error ?? `HTTP ${res.status}`)
    else { setStatus(data); setStatusError(null) }
  }, [])

  useEffect(() => {
    document.title = '8i11 | COROS MCP test'
    load_status()
  }, [load_status])

  async function post(body: unknown) {
    setBusy(true)
    setOutput('Working...')
    try {
      const res = await fetch('/api/coros/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setOutput(JSON.stringify(res.ok ? data : { status: res.status, ...data }, null, 2))
    } catch (err) {
      setOutput(`Request failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  function call_tool() {
    let parsed: unknown
    try { parsed = JSON.parse(args_text || '{}') } catch { setOutput('Arguments must be valid JSON.'); return }
    post({ action: 'call', tool, arguments: parsed })
  }

  async function disconnect() {
    setBusy(true)
    await fetch('/api/coros/disconnect', { method: 'POST' })
    await load_status()
    setBusy(false)
  }

  function copy_output() {
    navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const connected = !!status?.connected

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-gray-200 p-4">
      <NavTabs />
      <div className="max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-cyan-400">COROS MCP test</h1>
          <p className="text-sm text-gray-400 mt-1">Checks that this site can sign in to COROS and read your data. Read-only.</p>
        </div>

        {url_error && (
          <div className="p-3 rounded border border-red-400/40 bg-red-400/10 text-sm text-red-300 break-words">
            <div className="font-medium mb-1">COROS sign-in failed</div>
            {url_error}
          </div>
        )}
        {just_connected && connected && (
          <div className="p-3 rounded border border-green-400/40 bg-green-400/10 text-sm text-green-300">Connected to COROS.</div>
        )}
        {status_error && <p className="text-sm text-red-400">{status_error}</p>}

        <div className="p-4 bg-[#0f0f1a] border border-white/10 rounded space-y-1 text-sm">
          <div>
            <span className="text-gray-400">Status: </span>
            <span className={connected ? 'text-green-400' : 'text-yellow-400'}>{status ? (connected ? 'Connected' : 'Not connected') : 'Loading...'}</span>
          </div>
          {status && (
            <>
              <div className="break-all"><span className="text-gray-400">Server: </span>{status.server_url}</div>
              <div className="break-all"><span className="text-gray-400">This site: </span>{status.origin}</div>
            </>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <a href="/api/coros/authorize" className={`${btn} text-cyan-400`}>{connected ? 'Reconnect COROS' : 'Connect COROS'}</a>
            <button onClick={() => post({ action: 'sample' })} disabled={!connected || busy} className={btn}>Run 7-day sample</button>
            <button onClick={disconnect} disabled={!status?.registered || busy} className={btn}>Disconnect</button>
          </div>
        </div>

        <details className="p-4 bg-[#0f0f1a] border border-white/10 rounded text-sm">
          <summary className="cursor-pointer text-cyan-400">Call one tool</summary>
          <div className="space-y-2 pt-3">
            <select value={tool} onChange={e => setTool(e.target.value)} className="w-full bg-[#1a1a2e] border border-white/20 rounded px-2 py-1">
              {(status?.read_tools ?? []).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <textarea
              value={args_text}
              onChange={e => setArgsText(e.target.value)}
              rows={4}
              spellCheck={false}
              className="w-full bg-[#1a1a2e] border border-white/20 rounded px-2 py-1 font-mono text-xs"
            />
            <button onClick={call_tool} disabled={!connected || busy} className={btn}>Call</button>
          </div>
        </details>

        {output && (
          <div className="bg-[#0f0f1a] border border-white/10 rounded">
            <div className="flex justify-between items-center px-3 py-2 border-b border-white/10">
              <span className="text-sm text-cyan-400">Result</span>
              <button onClick={copy_output} disabled={busy} className="text-xs text-cyan-400 px-2 py-1 border border-white/10 rounded">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="p-3 text-xs overflow-auto max-h-[60vh] whitespace-pre-wrap break-words">{output}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

export default function CorosMcpPage() {
  return (
    <Suspense>
      <CorosMcpContent />
    </Suspense>
  )
}
