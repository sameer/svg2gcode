import { Button } from '@heroui/react'

import type { GcodeGenerationState } from '../hooks/useGcodeGeneration'

interface GenerateGcodePanelProps {
  state: GcodeGenerationState
  onDownload: () => void
  onDismiss: () => void
}

function progressLabel(state: GcodeGenerationState): string {
  if (!state.progress) return 'Preparing…'

  switch (state.progress.phase) {
    case 'processing': {
      const { current, total } = state.progress
      if (total > 0) {
        return `Processing operation ${current + 1} of ${total}…`
      }
      return 'Processing…'
    }
    case 'optimizing':
      return 'Optimizing toolpath order…'
    case 'formatting':
      return 'Generating GCode output…'
    default:
      return 'Working…'
  }
}

function progressPercent(state: GcodeGenerationState): number {
  if (!state.progress) return 0
  switch (state.progress.phase) {
    case 'processing': {
      const { current, total } = state.progress
      if (total > 0) return Math.round((current / total) * 85)
      return 10
    }
    case 'optimizing':
      return 90
    case 'formatting':
      return 95
    default:
      return 0
  }
}

export function GenerateGcodePanel({ state, onDownload, onDismiss }: GenerateGcodePanelProps) {
  if (state.isGenerating) {
    const percent = progressPercent(state)
    return (
      <div className="pointer-events-auto rounded-2xl border border-white/10 bg-[rgba(19,19,23,0.95)] p-4 text-white shadow-xl backdrop-blur-2xl">
        <p className="mb-2 text-sm font-medium">{progressLabel(state)}</p>
        <div className="h-1.5 w-64 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="pointer-events-auto rounded-2xl border border-red-500/30 bg-[rgba(19,19,23,0.95)] p-4 text-white shadow-xl backdrop-blur-2xl">
        <p className="mb-1 text-sm font-medium text-red-400">Generation failed</p>
        <p className="mb-3 text-xs text-white/60">{state.error}</p>
        <Button
          size="sm"
          className="rounded-full text-[13px] text-white"
          variant="secondary"
          onPress={onDismiss}
        >
          Dismiss
        </Button>
      </div>
    )
  }

  if (state.result) {
    const warnings = state.result.warnings
    const lines = state.result.gcode.split('\n').length
    const ops = state.result.operation_ranges.length

    return (
      <div className="pointer-events-auto rounded-2xl border border-white/10 bg-[rgba(19,19,23,0.95)] p-4 text-white shadow-xl backdrop-blur-2xl">
        <p className="mb-1 text-sm font-medium text-emerald-400">GCode generated</p>
        <p className="mb-3 text-xs text-white/60">
          {lines.toLocaleString()} lines, {ops} operation{ops !== 1 ? 's' : ''}
        </p>

        {warnings.length > 0 && (
          <div className="mb-3 rounded-lg bg-yellow-500/10 p-2">
            <p className="mb-1 text-xs font-medium text-yellow-400">Warnings</p>
            {warnings.map((w, i) => (
              <p key={i} className="text-xs text-yellow-200/70">{w}</p>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            className="rounded-full bg-emerald-600 text-[13px] font-medium text-white hover:bg-emerald-500"
            onPress={onDownload}
          >
            Download .gcode
          </Button>
          <Button
            size="sm"
            className="rounded-full text-[13px] text-white"
            variant="secondary"
            onPress={onDismiss}
          >
            Close
          </Button>
        </div>
      </div>
    )
  }

  return null
}
