import { Button, Label, ProgressBar } from '@heroui/react'
import type { JobProgress } from '@svg2gcode/bridge'

import { AppIcon, Icons } from '../lib/icons'
import type { ViewMode } from '../types/preview'

interface TopBarProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  onExport: () => void
  onImport: () => void
  onGenerateGcode: () => void
  onPreview: () => void
  isGenerating?: boolean
  progress?: JobProgress | null
  hasGcodeResult?: boolean
}

function progressLabel(progress: JobProgress | null | undefined): string {
  if (!progress) return 'Preparing GCode generation…'

  switch (progress.phase) {
    case 'processing': {
      const { current, total } = progress
      if (total > 0) {
        return `Processing operation ${Math.min(current + 1, total)} of ${total}`
      }
      return 'Processing operations…'
    }
    case 'optimizing':
      return 'Optimizing toolpath order…'
    case 'formatting':
      return 'Formatting GCode output…'
    default:
      return 'Generating GCode…'
  }
}

function progressPercent(progress: JobProgress | null | undefined): number {
  if (!progress) return 3

  switch (progress.phase) {
    case 'processing': {
      const { current, total } = progress
      if (total > 0) return Math.max(5, Math.min(85, Math.round((current / total) * 85)))
      return 10
    }
    case 'optimizing':
      return 92
    case 'formatting':
      return 97
    default:
      return 3
  }
}

export function TopBar({
  viewMode,
  onViewModeChange,
  onExport,
  onImport,
  onGenerateGcode,
  onPreview,
  isGenerating,
  progress,
  hasGcodeResult,
}: TopBarProps) {
  const percent = progressPercent(progress)

  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex min-w-[min(100%,52rem)] max-w-[min(100%,52rem)] flex-col rounded-[1.75rem] border border-white/10 bg-[rgba(19,19,23,0.9)] px-3 py-3 text-white shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl transition-all duration-300">
        <div className="flex min-h-10 items-center gap-3">
          {/* Tab — Design / Preview */}
          <div className="flex h-10 items-center rounded-[1.2rem] bg-[#27272A] px-1">
            <button
              type="button"
              className={`flex h-8 items-center rounded-[0.9rem] px-4 text-sm font-medium transition ${
                viewMode === 'design'
                  ? 'bg-[#3f3f46] text-white'
                  : 'text-white/40 hover:text-white/60'
              }`}
              onClick={() => onViewModeChange('design')}
            >
              Design
            </button>
            <button
              type="button"
              className={`flex h-8 items-center rounded-[0.9rem] px-4 text-sm font-medium transition ${
                viewMode === 'preview'
                  ? 'bg-[#3f3f46] text-white'
                  : hasGcodeResult
                    ? 'text-white/40 hover:text-white/60'
                    : 'cursor-not-allowed text-white/20'
              }`}
              onClick={() => {
                if (hasGcodeResult) {
                  onViewModeChange('preview')
                }
              }}
            >
              Preview
            </button>
          </div>

          {viewMode === 'design' ? (
            <>
              <Button
                className="rounded-full text-[14px] text-white"
                size="sm"
                variant="secondary"
                onPress={onImport}
              >
                <AppIcon icon={Icons.fileUpload} className="h-4 w-4" />
                Import SVG
              </Button>

              <Button
                className="rounded-full text-[14px] text-white"
                size="sm"
                variant="secondary"
                onPress={onExport}
              >
                <AppIcon icon={Icons.export} className="h-4 w-4" />
                Export
              </Button>

              <div className="mx-1 h-6 w-px bg-white/10" />

              <Button
                className="rounded-full bg-emerald-600 text-[14px] font-medium text-white hover:bg-emerald-500"
                size="sm"
                isDisabled={isGenerating}
                onPress={onGenerateGcode}
              >
                {isGenerating ? 'Generating…' : 'Generate GCode'}
              </Button>

              {hasGcodeResult && (
                <Button
                  className="rounded-full bg-sky-600 text-[14px] font-medium text-white hover:bg-sky-500"
                  size="sm"
                  onPress={onPreview}
                >
                  3D Preview
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                className="rounded-full text-[14px] text-white"
                size="sm"
                variant="secondary"
                onPress={() => onViewModeChange('design')}
              >
                Back to Design
              </Button>
            </>
          )}
        </div>

        {isGenerating && (
          <div className="mt-3 border-t border-white/10 pt-3">
            <ProgressBar aria-label="GCode generation progress" className="w-full" value={percent}>
              <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                <Label className="text-sm font-medium text-white">{progressLabel(progress)}</Label>
                <ProgressBar.Output className="text-xs text-white/60" />
              </div>
              <ProgressBar.Track className="h-2 overflow-hidden rounded-full bg-white/10">
                <ProgressBar.Fill className="rounded-full bg-emerald-500 transition-all duration-300" />
              </ProgressBar.Track>
            </ProgressBar>
          </div>
        )}
      </div>
    </div>
  )
}
