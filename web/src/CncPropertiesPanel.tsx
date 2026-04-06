import { Button, Input } from '@heroui/react'

import { isOpenPathNode, normalizeEngraveType } from './lib/cncVisuals'
import { useEditorStore } from './store'
import type { CncMetadata, EngraveType } from './types/editor'

const ALL_ENGRAVE_TYPES: EngraveType[] = ['contour', 'pocket']

const ENGRAVE_LABEL: Record<EngraveType, string> = {
  contour: 'Contour',
  outline: 'Outline',
  pocket: 'Pocket',
  raster: 'Raster',
}

export function CncPropertiesPanel() {
  const selectedIds = useEditorStore((state) => state.selectedIds)
  const nodesById = useEditorStore((state) => state.nodesById)
  const updateCncMetadata = useEditorStore((state) => state.updateCncMetadata)

  if (selectedIds.length === 0) {
    return (
      <div className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-stone-500">
          CNC Properties
        </p>
        <p className="text-sm text-stone-400">Select a shape to edit CNC properties.</p>
      </div>
    )
  }

  // Derive values from the first selected node for pre-filling inputs.
  const firstNode = nodesById[selectedIds[0]]
  const representativeMeta: CncMetadata = firstNode?.cncMetadata ?? {}
  const allOpenPaths = selectedIds.every((id) => {
    const n = nodesById[id]
    return n ? isOpenPathNode(n) : false
  })
  const availableEngraveTypes = allOpenPaths
    ? ALL_ENGRAVE_TYPES.filter((t) => t === 'contour')
    : ALL_ENGRAVE_TYPES

  const applyAll = (patch: Partial<CncMetadata>) => {
    selectedIds.forEach((id) => {
      updateCncMetadata(id, patch)
    })
  }

  const clearAll = () => {
    selectedIds.forEach((id) => {
      updateCncMetadata(id, { cutDepth: undefined, engraveType: undefined })
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-stone-500">
          CNC Properties
        </p>
        {selectedIds.length > 1 && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
            Editing {selectedIds.length} nodes
          </span>
        )}
      </div>

      {/* Cut Depth */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-stone-600">
          Cut Depth (mm)
        </label>
        <div className="flex items-center gap-2">
          <Input
            aria-label="Cut depth in mm"
            type="number"
            step="0.1"
            min="0"
            max="20"
            placeholder="e.g. 3.5"
            value={representativeMeta.cutDepth !== undefined ? String(representativeMeta.cutDepth) : ''}
            className="w-36"
            onChange={(event) => {
              const raw = event.target.value
              if (raw === '') {
                applyAll({ cutDepth: undefined })
                return
              }
              const parsed = parseFloat(raw)
              if (Number.isFinite(parsed) && parsed >= 0) {
                applyAll({ cutDepth: parsed })
              }
            }}
          />
          {representativeMeta.cutDepth !== undefined && (
            <div
              className="h-4 w-4 flex-shrink-0 rounded-full border border-stone-300"
              title={`Depth: ${representativeMeta.cutDepth}mm`}
              style={{
                background: (() => {
                  const ratio = Math.min(1, Math.max(0, representativeMeta.cutDepth / 20))
                  const hue = Math.round(60 * (1 - ratio))
                  return `hsl(${hue}, 100%, 45%)`
                })(),
              }}
            />
          )}
        </div>
        {/* Depth color legend */}
        <div className="flex items-center gap-2">
          <div
            className="h-2 flex-1 rounded-full"
            style={{
              background: 'linear-gradient(to right, hsl(60,100%,45%), hsl(30,100%,45%), hsl(0,100%,45%))',
            }}
          />
          <span className="whitespace-nowrap text-xs text-stone-400">0 → 20mm</span>
        </div>
      </div>

      {/* Engrave Type */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-stone-600">
          Engrave Type
        </label>
        <div className="flex gap-1.5">
          {availableEngraveTypes.map((type) => {
            const isActive = normalizeEngraveType(representativeMeta.engraveType) === type
            return (
              <Button
                key={type}
                variant={isActive ? 'primary' : 'outline'}
                className={
                  isActive
                    ? 'border-amber-700 bg-amber-700 text-white text-xs'
                    : 'border-stone-400 bg-white/60 text-stone-700 text-xs'
                }
                onPress={() => {
                  applyAll({ engraveType: isActive ? undefined : type })
                }}
              >
                {ENGRAVE_LABEL[type]}
              </Button>
            )
          })}
        </div>

        {/* Engrave type visual legend */}
        <div className="grid grid-cols-2 gap-1 text-xs text-stone-500">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm border border-stone-300 bg-transparent" />
            Contour
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-sm border border-stone-300 bg-[#d4d4d4]" />
            Pocket
          </div>
        </div>
      </div>

      {/* Summary of current values */}
      {(representativeMeta.cutDepth !== undefined || representativeMeta.engraveType) && (
        <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-3 text-xs text-stone-600 space-y-1">
          {representativeMeta.cutDepth !== undefined && (
            <div><span className="font-medium text-stone-800">Depth:</span> {representativeMeta.cutDepth}mm</div>
          )}
          {representativeMeta.engraveType && (
            <div><span className="font-medium text-stone-800">Type:</span> {representativeMeta.engraveType}</div>
          )}
        </div>
      )}

      {/* Clear */}
      <Button
        variant="outline"
        className="w-full border-rose-300 bg-rose-50/70 text-rose-700 text-sm"
        onPress={clearAll}
      >
        Clear CNC data
      </Button>
    </div>
  )
}
