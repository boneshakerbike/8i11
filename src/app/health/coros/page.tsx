'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'
import NavTabs from '@/components/nav_tabs'

const CHROME_PROMPT = `Generate a comprehensive morning training report from the COROS Training Hub by collecting data from all key sections:

1. Start at the Dashboard tab (https://t.coros.com/admin/views/dash-board)
2. Capture all Dashboard metrics including:
   - Weekly Activity chart data
   - Recent Activities list
   - Overnight HRV status and ranges
   - Training Status (Maintaining/Optimized/etc.)
   - 7-Day Efficiency Scores
   - Threshold Heart Rate Zones
   - Recovery status and percentage
   - Personal Cycling Records
   - Race Predictor data

3. Navigate to EvoLab Metrics tab and capture:
   - Training Status (12 weeks) graph
   - Training Summary (4 weeks): Total Distance, Total Time, Total Load, Times, Average HR
   - Activity Data (12 weeks): Training Load chart
   - Running Fitness & Efficiency (12 weeks)
   - 4-Week Intensity Distribution (Hard/Med/Easy breakdown by training load)
   - VO2 Max (12 weeks) with Max and Avg values
   - Distance Zone Distribution (4 weeks) with frequency percentages
   - Threshold Heart Rate Zones Distribution (4 weeks) with load breakdown
   - Overnight HRV (4 weeks) with average value
   - Weekly Training Load (12 weeks) chart data
   - Resting Heart Rate (12 weeks) with Low and Avg values

4. Navigate to Activity List tab and identify yesterday's date
5. For EACH activity from yesterday (sort by date descending):
   - Click on the activity name to open detailed view
   - Capture summary metrics: Distance/Sets, Activity Time, Total Time, Avg Speed/Pace, Avg HR, Elevation Gain, Total Descent, Calories, Training Load
   - Expand "Time in Zones" section and capture HR Zone breakdown (zone ranges, times, percentages)
   - For running activities: Expand Pace Zone breakdown instead
   - For strength/flexibility activities: Capture exercise list with load/rest/time/calories per exercise, sets count, total reps
   - Capture Efficiency, Aerobic TE, Anaerobic TE values
   - Note the activity timestamp (date and time)
   - Go back to Activity List and repeat for next activity

6. Compile all collected data into a structured markdown report with sections for:
   - Overnight HRV & Recovery Status
   - Training Status & Fitness metrics
   - Yesterday's Activities (each activity with full details, HR/pace zone tables, key observations)
   - Daily/Weekly Training Load summaries
   - EvoLab 4-Week metrics with zone distribution tables
   - Personal Records section
   - Race Predictor table
   - Key Takeaways based on recovery status, training load, and overall patterns

7. POST the compiled report as JSON to:

   POST https://8i11.vercel.app/api/coros/save
   Headers:
     Content-Type: application/json
     X-Guest-Pin: [YOUR_PIN]

   Body:
   {
     "date": "YYYY-MM-DD",
     "data": {
       "report_markdown": "<the full markdown report>",
       "dashboard": { ... captured dashboard metrics ... },
       "evolab": { ... captured EvoLab metrics ... },
       "activities": [ ... yesterday's activity details ... ]
     }
   }

   Use today's date for the "date" field.

8. Once the POST succeeds, close all browser tabs and windows that were opened or used for this automation and terminate the session.

Format the report as a professional morning briefing suitable for a cyclist/runner with training data visualization through tables and emojis for quick scanning. Include specific values, not ranges. Calculate daily totals and weekly totals where applicable.`

function today_str(): string {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

export default function CorosPage() {
  const [date, setDate] = useState(today_str())
  const [row, setRow] = useState<{ date: string; data: Record<string, unknown>; source: string; updated_at: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copiedSection, setCopiedSection] = useState<string | null>(null)
  const [pasteInput, setPasteInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  useEffect(() => {
    document.title = '8i11 | COROS'
  }, [])

  function fetch_row(d: string) {
    return fetch(`/api/coros/data?date=${d}`)
      .then(res => {
        if (res.status === 404) return null
        if (!res.ok) return res.json().then(e => { throw new Error(e.error || 'Fetch failed') })
        return res.json()
      })
      .then(data => {
        setRow(data)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }

  useEffect(() => {
    if (!date) return
    setLoading(true)
    setRow(null)
    setError(null)
    fetch_row(date)
  }, [date])

  async function save_paste() {
    if (!pasteInput.trim() || !date) return
    setSaving(true)
    setSaveError(null)
    setSaveStatus(null)
    try {
      let data: Record<string, unknown>
      try {
        const parsed = JSON.parse(pasteInput)
        data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { report_markdown: pasteInput }
      } catch {
        data = { report_markdown: pasteInput }
      }
      const res = await fetch('/api/coros/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, data }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Save failed')
      }
      setPasteInput('')
      setSaveStatus('Saved!')
      setTimeout(() => setSaveStatus(null), 2000)
      await fetch_row(date)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function copy_section(name: string, content: string) {
    return (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      navigator.clipboard.writeText(content)
      setCopiedSection(name)
      setTimeout(() => setCopiedSection(null), 1500)
    }
  }

  const training_status = row
    ? (row.data as any)?.dashboard?.training_status?.status ?? (row.data as any)?.data?.training_status_dashboard?.status ?? '—'
    : null
  const recovery_pct = row
    ? (row.data as any)?.dashboard?.recovery?.percentage ?? (row.data as any)?.data?.recovery?.percent ?? null
    : null
  const recovery_status = row
    ? (row.data as any)?.dashboard?.recovery?.status ?? (row.data as any)?.data?.recovery?.status ?? null
    : null
  const recovery_str = recovery_pct != null || recovery_status != null
    ? `${recovery_pct != null ? recovery_pct + '%' : '—'} — ${recovery_status ?? '—'}`
    : '—'
  const report_markdown = row ? (row.data as any)?.report_markdown ?? (row.data as any)?.markdown : null

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-gray-200 p-4">
      <NavTabs />
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-cyan-400 mb-1">COROS</h1>
        <a href="/health/coros/mcp" className="inline-block text-sm text-cyan-400/70 hover:text-cyan-400 mb-4">Test the COROS MCP connection</a>

        <div className="mb-4">
          <label className="text-sm text-gray-400 mr-2">Date:</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="bg-[#0f0f1a] border border-white/20 rounded px-2 py-1 text-gray-200 text-sm [color-scheme:dark]"
          />
        </div>

        {loading && <p className="text-gray-400 text-sm">Loading...</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {!loading && !error && row === null && (
          <p className="text-gray-500 text-sm">No data for this date.</p>
        )}

        {row && (
          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-3">Source: {row.source} &bull; Updated: {row.updated_at}</p>

            {/* Status bar */}
            <div className="flex gap-6 mb-3 text-sm">
              <span>
                <span className="text-gray-400">Training Status: </span>
                <span className="text-gray-200">{training_status}</span>
              </span>
              <span>
                <span className="text-gray-400">Recovery: </span>
                <span className="text-gray-200">{recovery_str}</span>
              </span>
            </div>


            {/* Report Markdown */}
            {report_markdown && (
              <details className="mb-3 bg-[#0f0f1a] border border-white/10 rounded">
                <summary className="cursor-pointer flex justify-between items-center px-3 py-2 text-sm text-cyan-400">
                  <span>Report Markdown</span>
                  <button
                    onClick={copy_section('report', report_markdown)}
                    className="text-xs text-cyan-400 hover:text-cyan-300 px-2 py-1 border border-white/10 rounded"
                  >
                    {copiedSection === 'report' ? 'Copied!' : 'Copy'}
                  </button>
                </summary>
                <pre className="text-xs text-gray-300 p-3 overflow-x-auto whitespace-pre-wrap">
                  {report_markdown}
                </pre>
              </details>
            )}

            {/* Raw JSON */}
            <details className="mb-3 bg-[#0f0f1a] border border-white/10 rounded">
              <summary className="cursor-pointer flex justify-between items-center px-3 py-2 text-sm text-cyan-400">
                <span>Raw JSON</span>
                <button
                  onClick={copy_section('raw', JSON.stringify(row.data, null, 2))}
                  className="text-xs text-cyan-400 hover:text-cyan-300 px-2 py-1 border border-white/10 rounded"
                >
                  {copiedSection === 'raw' ? 'Copied!' : 'Copy'}
                </button>
              </summary>
              <pre className="text-xs text-gray-300 p-3 overflow-x-auto">
                {JSON.stringify(row.data, null, 2)}
              </pre>
            </details>
          </div>
        )}

        {/* Manual paste-and-save */}
        <div className="mt-4 border-t border-white/10 pt-4">
          <h2 className="text-sm text-gray-400 mb-2">Manual Input</h2>
          <textarea
            value={pasteInput}
            onChange={e => setPasteInput(e.target.value)}
            placeholder="Paste the scraped Markdown or JSON report here, then Save."
            className="w-full bg-[#0f0f1a] border border-white/10 rounded p-3 text-xs text-gray-200 font-mono resize-none focus:outline-none placeholder-gray-600"
            style={{ minHeight: '160px' }}
          />
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={save_paste}
              disabled={saving || !pasteInput.trim()}
              className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-white/10 disabled:text-gray-500 text-black font-semibold rounded text-sm transition-all"
            >
              {saving ? 'Saving...' : 'Save to 8i11'}
            </button>
            {saveStatus && <span className="text-green-400 text-sm">{saveStatus}</span>}
            {saveError && <span className="text-red-400 text-sm">{saveError}</span>}
          </div>
        </div>

        {/* Chrome Extension Prompt */}
        <div className="mt-4 border-t border-white/10 pt-4">
          <details className="bg-[#0f0f1a] border border-white/10 rounded">
            <summary className="cursor-pointer flex justify-between items-center px-3 py-2 text-sm text-cyan-400">
              <span>Chrome Extension Prompt (replace &apos;[YOUR_PIN]&apos; with your value)</span>
              <button
                onClick={copy_section('prompt', CHROME_PROMPT)}
                className="text-xs text-cyan-400 hover:text-cyan-300 px-2 py-1 border border-white/10 rounded"
              >
                {copiedSection === 'prompt' ? 'Copied!' : 'Copy'}
              </button>
            </summary>
            <pre className="text-xs text-gray-300 p-3 overflow-x-auto whitespace-pre-wrap">
              {CHROME_PROMPT}
            </pre>
          </details>
        </div>
      </div>
    </div>
  )
}
