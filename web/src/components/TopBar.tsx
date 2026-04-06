import { Button } from '@heroui/react'

import { AppIcon, Icons } from '../lib/icons'

interface TopBarProps {
  onExport: () => void
  onImport: () => void
  onGenerateGcode: () => void
  isGenerating?: boolean
}

export function TopBar({ onExport, onImport, onGenerateGcode, isGenerating }: TopBarProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto inline-flex h-16 items-center gap-3 rounded-[1.75rem] border border-white/10 bg-[rgba(19,19,23,0.9)] px-3 text-white shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
        {/* Tab — Design only, Preview out of scope */}
        <div className="flex h-10 items-center rounded-[1.2rem] bg-[#27272A] px-1">
          <div className="flex h-8 items-center rounded-[0.9rem] bg-[#3f3f46] px-4 text-sm font-medium text-white">
            Design
          </div>
          <div className="flex h-8 items-center rounded-[0.9rem] px-4 text-sm text-white/40">
            Preview
          </div>
        </div>

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
      </div>
    </div>
  )
}
