import { useRef, useEffect, useMemo } from 'react'
import { sampleProgramAtDistance } from '@svg2gcode/bridge/viewer'

import { useEditorStore } from '../../store'

export function GcodeViewer() {
  const gcodeText = useEditorStore((s) => s.preview.gcodeText)
  const parsedProgram = useEditorStore((s) => s.preview.parsedProgram)
  const playbackDistance = useEditorStore((s) => s.preview.playbackDistance)
  const setViewMode = useEditorStore((s) => s.setViewMode)

  const scrollRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLDivElement>(null)

  const lines = useMemo(() => (gcodeText ?? '').split('\n'), [gcodeText])

  const currentLineNumber = useMemo(() => {
    if (!parsedProgram || playbackDistance <= 0) return -1
    const sample = sampleProgramAtDistance(parsedProgram, playbackDistance)
    return sample.segment?.lineNumber ?? -1
  }, [parsedProgram, playbackDistance])

  // Auto-scroll to current line during playback
  useEffect(() => {
    if (activeLineRef.current && scrollRef.current) {
      activeLineRef.current.scrollIntoView({ block: 'center', behavior: 'auto' })
    }
  }, [currentLineNumber])

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">GCode Preview</h2>
        <button
          type="button"
          className="rounded-md border border-border bg-content1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setViewMode('design')}
        >
          Back to Design
        </button>
      </div>

      {/* Stats */}
      <div className="flex gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span>{lines.length.toLocaleString()} lines</span>
        {parsedProgram && (
          <>
            <span>{parsedProgram.segments.length.toLocaleString()} moves</span>
            <span>{formatDistance(parsedProgram.totalDistance)} total</span>
          </>
        )}
      </div>

      {/* GCode text */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto font-mono text-xs">
        {lines.map((line, i) => {
          const lineNum = i + 1
          const isActive = lineNum === currentLineNumber
          const colorClass = getLineColorClass(line)

          return (
            <div
              key={i}
              ref={isActive ? activeLineRef : undefined}
              className={`flex px-2 py-px ${
                isActive ? 'bg-amber-500/20 text-amber-300' : ''
              }`}
            >
              <span className="w-12 shrink-0 select-none pr-2 text-right text-muted-foreground/40">
                {lineNum}
              </span>
              <span className={isActive ? '' : colorClass}>{line}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function getLineColorClass(line: string): string {
  const trimmed = line.trim()
  if (trimmed.startsWith(';') || trimmed.startsWith('(')) return 'text-emerald-500/60'
  if (trimmed.startsWith('G0 ') || trimmed.startsWith('G00 ') || trimmed === 'G0' || trimmed === 'G00') return 'text-white/40'
  if (trimmed.startsWith('G1 ') || trimmed.startsWith('G01 ') || trimmed === 'G1' || trimmed === 'G01') return 'text-sky-400/70'
  return 'text-white/60'
}

function formatDistance(mm: number): string {
  if (mm >= 1000) return `${(mm / 1000).toFixed(1)}m`
  return `${mm.toFixed(0)}mm`
}
