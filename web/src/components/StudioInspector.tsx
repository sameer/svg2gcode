import { useMemo, useState } from 'react'
import { Button, Tabs } from '@heroui/react'

import { normalizeEngraveType } from '../lib/cncVisuals'
import { isGroupNode } from '../lib/editorTree'
import { getNodeSize, getNodeOffsetMm, offsetMmToCanvasY } from '../lib/nodeDimensions'
import { useEditorStore } from '../store'
import type { CanvasNode, CncMetadata, EngraveType, MachiningSettings, RouterBitShape } from '../types/editor'
import { MATERIAL_PRESETS } from '../lib/materialPresets'
import type { MaterialPreset } from '../lib/materialPresets'
import flatRouterBitImg from '../assets/router_bits/flat_router_bit.png'
import roundRouterBitImg from '../assets/router_bits/round_router_bit.png'
import vCarveBitImg from '../assets/router_bits/v_carve_bit.png'

type InspectorTab = 'design' | 'material'
type NormalizedCutDepthFill = 'contour' | 'pocket'

const ENGRAVE_TYPES: EngraveType[] = ['contour', 'pocket']
const ENGRAVE_LABEL: Record<EngraveType, string> = {
  contour: 'Contour',
  outline: 'Outline',
  pocket: 'Pocket',
  raster: 'Raster',
}

interface StudioInspectorProps {
  activeTab: InspectorTab
  onTabChange: (tab: InspectorTab) => void
  materialPreset: MaterialPreset
  onMaterialChange: (preset: MaterialPreset) => void
}

export function StudioInspector({ activeTab, onTabChange, materialPreset, onMaterialChange }: StudioInspectorProps) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4">
        <div className="h-9 w-9 rounded-full bg-primary/30" />
        <Button size="sm">Share</Button>
      </div>

      {/* Tabs */}
      <div className="px-4 pb-4">
        <Tabs
          className="w-full"
          selectedKey={activeTab}
          onSelectionChange={(key) => onTabChange(String(key) as InspectorTab)}
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="Inspector tabs">
              <Tabs.Tab id="design">
                Design
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="material">
                Material
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {activeTab === 'design' ? (
          <DesignTabContent />
        ) : (
          <MaterialTabContent materialPreset={materialPreset} onMaterialChange={onMaterialChange} />
        )}
      </div>
    </div>
  )
}

function DesignTabContent() {
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const nodesById = useEditorStore((s) => s.nodesById)
  const artboard = useEditorStore((s) => s.artboard)
  const updateNodeTransform = useEditorStore((s) => s.updateNodeTransform)
  const updateCncMetadata = useEditorStore((s) => s.updateCncMetadata)
  const selectMany = useEditorStore((s) => s.selectMany)

  const firstNode = selectedIds.length > 0 ? nodesById[selectedIds[0]] : null
  const meta: CncMetadata = firstNode?.cncMetadata ?? {}
  const allCutDepthGroups = useMemo(() => buildCutDepthGroups(nodesById), [nodesById])

  // Compute dimensions and offset for the selected node
  const nodeSize = useMemo(
    () => (firstNode ? getNodeSize(firstNode, nodesById) : null),
    [firstNode, nodesById],
  )
  const nodeOffset = useMemo(
    () => (firstNode && nodeSize ? getNodeOffsetMm(firstNode, nodeSize, artboard) : null),
    [firstNode, nodeSize, artboard],
  )

  const applyAll = (patch: Partial<CncMetadata>) => {
    selectedIds.forEach((id) => updateCncMetadata(id, patch))
  }

  const applyToIds = (ids: string[], patch: Partial<CncMetadata>) => {
    ids.forEach((id) => updateCncMetadata(id, patch))
  }

  const clearAll = () => {
    selectedIds.forEach((id) =>
      updateCncMetadata(id, { cutDepth: undefined, engraveType: undefined }),
    )
  }

  return (
    <div className="space-y-5">
      {/* Selected art */}
      <section className="space-y-4">
        <SectionHeading title="Selected art" />
        {firstNode ? (
          <div className="rounded-md border border-border bg-content1 px-3 py-3">
            <p className="text-sm font-medium text-foreground">{firstNode.name || firstNode.id}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {firstNode.type}
              {selectedIds.length > 1 ? ` · ${selectedIds.length} selected` : ''}
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-content1 px-3 py-3 text-sm text-muted-foreground">
            Select an art object to edit its placement and dimensions.
          </div>
        )}
      </section>

      {/* Dimensions & offset */}
      {firstNode && nodeSize && nodeOffset && (
        <section className="space-y-4">
          <SectionHeading title="Dimensions" />
          <div className="flex flex-wrap gap-2">
            <NumberPill
              label="W"
              value={round2(nodeSize.width)}
              unit="mm"
              onChange={(v) => {
                if (v === null || v <= 0 || nodeSize.baseWidth <= 0) return
                const ratio = v / nodeSize.baseWidth
                selectedIds.forEach((id) => {
                  const node = nodesById[id]
                  if (!node) return
                  const ns = getNodeSize(node, nodesById)
                  if (ns.baseWidth <= 0) return
                  if (node.type === 'rect') {
                    const aspectRatio = ns.baseHeight / ns.baseWidth
                    updateNodeTransform(id, { width: v, height: v * aspectRatio } as Partial<CanvasNode>)
                  } else {
                    updateNodeTransform(id, { scaleX: ratio, scaleY: ratio } as Partial<CanvasNode>)
                  }
                })
              }}
            />
            <NumberPill
              label="H"
              value={round2(nodeSize.height)}
              unit="mm"
              onChange={(v) => {
                if (v === null || v <= 0 || nodeSize.baseHeight <= 0) return
                const ratio = v / nodeSize.baseHeight
                selectedIds.forEach((id) => {
                  const node = nodesById[id]
                  if (!node) return
                  const ns = getNodeSize(node, nodesById)
                  if (ns.baseHeight <= 0) return
                  if (node.type === 'rect') {
                    const aspectRatio = ns.baseWidth / ns.baseHeight
                    updateNodeTransform(id, { height: v, width: v * aspectRatio } as Partial<CanvasNode>)
                  } else {
                    updateNodeTransform(id, { scaleY: ratio, scaleX: ratio } as Partial<CanvasNode>)
                  }
                })
              }}
            />
          </div>
          <SectionHeading title="Offset" />
          <div className="flex flex-wrap gap-2">
            <NumberPill
              label="X"
              value={round2(nodeOffset.x)}
              unit="mm"
              onChange={(v) => {
                if (v === null) return
                selectedIds.forEach((id) => {
                  updateNodeTransform(id, { x: v } as Partial<CanvasNode>)
                })
              }}
            />
            <NumberPill
              label="Y"
              value={round2(nodeOffset.y)}
              unit="mm"
              onChange={(v) => {
                if (v === null) return
                selectedIds.forEach((id) => {
                  const node = nodesById[id]
                  if (!node) return
                  const ns = getNodeSize(node, nodesById)
                  updateNodeTransform(id, { y: offsetMmToCanvasY(v, ns.height, artboard) } as Partial<CanvasNode>)
                })
              }}
            />
          </div>
        </section>
      )}

      {/* Cut depths */}
      <section className="space-y-4">
        <SectionHeading
          title="Cut depths"
          rightContent={
            selectedIds.length > 1 ? (
              <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                Editing {selectedIds.length} selected
              </span>
            ) : selectedIds.length === 0 && allCutDepthGroups.length > 0 ? (
              <span className="rounded-full border border-border bg-content1 px-2 py-0.5 text-xs text-muted-foreground">
                {allCutDepthGroups.length} groups
              </span>
            ) : null
          }
        />

        {selectedIds.length === 0 ? (
          <CutDepthGroupsList
            groups={allCutDepthGroups}
            showSelectButton
            onDepthChange={(ids, value) => applyToIds(ids, { cutDepth: value })}
            onFillModeChange={(ids, value) => applyToIds(ids, { engraveType: value })}
            onSelectGroup={selectMany}
          />
        ) : (
          <div className="space-y-4">
            {/* Depth input */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-border bg-content1 px-2">
                  <span className="shrink-0 text-xs text-muted-foreground">Depth</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="20"
                    placeholder="e.g. 3.5"
                    value={meta.cutDepth !== undefined ? String(meta.cutDepth) : ''}
                    className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-sm text-foreground outline-none"
                    onChange={(e) => {
                      const raw = e.target.value
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
                  <span className="shrink-0 text-xs text-muted-foreground">mm</span>
                </div>
                {meta.cutDepth !== undefined && (
                  <div
                    className="h-4 w-4 shrink-0 rounded-full border border-border"
                    title={`Depth: ${meta.cutDepth}mm`}
                    style={{
                      background: (() => {
                        const ratio = Math.min(1, Math.max(0, meta.cutDepth / 20))
                        return `hsl(${Math.round(60 * (1 - ratio))}, 100%, 45%)`
                      })(),
                    }}
                  />
                )}
              </div>
              {/* Depth gradient */}
              <div className="flex items-center gap-2">
                <div
                  className="h-1.5 flex-1 rounded-full"
                  style={{
                    background:
                      'linear-gradient(to right, hsl(60,100%,45%), hsl(30,100%,45%), hsl(0,100%,45%))',
                  }}
                />
                <span className="shrink-0 text-xs text-muted-foreground">0 → 20mm</span>
              </div>
            </div>

            {/* Part fill / engrave type */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Part fill</p>
              <div className="flex gap-1.5">
                {ENGRAVE_TYPES.map((type) => {
                  const isActive = normalizeEngraveType(meta.engraveType) === type
                  return (
                    <Button
                      key={type}
                      size="sm"
                      variant={isActive ? 'primary' : 'secondary'}
                      onPress={() => applyAll({ engraveType: isActive ? undefined : type })}
                    >
                      {ENGRAVE_LABEL[type]}
                    </Button>
                  )
                })}
              </div>
              {/* Engrave type visual legend */}
              <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded-sm border border-border bg-transparent" />
                  Contour
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded-sm border border-border bg-[#d4d4d4]" />
                  Pocket
                </div>
              </div>
            </div>

            {/* Clear */}
            <Button variant="secondary" className="w-full text-sm text-danger" onPress={clearAll}>
              Clear CNC data
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

function MaterialTabContent({
  materialPreset,
  onMaterialChange,
}: {
  materialPreset: MaterialPreset
  onMaterialChange: (preset: MaterialPreset) => void
}) {
  const artboard = useEditorStore((s) => s.artboard)
  const selectedStage = useEditorStore((s) => s.selectedStage)
  const setArtboardSize = useEditorStore((s) => s.setArtboardSize)
  const machiningSettings = useEditorStore((s) => s.machiningSettings)
  const setMachiningSettings = useEditorStore((s) => s.setMachiningSettings)
  const nodesById = useEditorStore((s) => s.nodesById)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const setField = (patch: Partial<MachiningSettings>) => setMachiningSettings(patch)

  const maxCutDepth = Object.values(nodesById).reduce<number>((max, node) => {
    const d = node.cncMetadata?.cutDepth
    return d !== undefined && d > max ? d : max
  }, machiningSettings.defaultDepthMm)

  const depthPerPass =
    machiningSettings.passCount > 1
      ? Math.round((maxCutDepth / machiningSettings.passCount) * 100) / 100
      : null

  return (
    <div className="space-y-5">
      {/* Material selector */}
      <section className="space-y-3">
        <SectionHeading title="Material" />
        <div className="flex flex-wrap gap-2">
          <NumberPill label="W" value={artboard.width} unit="mm"
            onChange={(v) => { if (v !== null && v >= 1) setArtboardSize({ width: Math.round(v) }) }} />
          <NumberPill label="H" value={artboard.height} unit="mm"
            onChange={(v) => { if (v !== null && v >= 1) setArtboardSize({ height: Math.round(v) }) }} />
          <NumberPill label="T" value={artboard.thickness} unit="mm"
            onChange={(v) => { if (v !== null && v >= 0) setArtboardSize({ thickness: v }) }} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MATERIAL_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`relative overflow-hidden rounded-lg border-2 transition ${
                materialPreset === preset.id
                  ? 'border-primary'
                  : 'border-border hover:border-border/80'
              }`}
              onClick={() => onMaterialChange(preset.id)}
            >
              <img
                src={preset.textureSrc}
                alt={preset.label}
                className="h-14 w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-black/50 px-1 py-1 text-center text-xs font-medium text-white">
                {preset.label}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Router bit */}
      <section className="space-y-3">
        <SectionHeading title="Router bit" />
        <div className="flex items-end gap-3">
          <NumberField label="Diameter" unit="mm" value={machiningSettings.toolDiameter}
            onChange={(v) => { if (v !== null) setField({ toolDiameter: v }) }} />
          <NumberField label="Height" unit="mm" value={machiningSettings.defaultDepthMm}
            onChange={(v) => { if (v !== null) setField({ defaultDepthMm: v }) }} />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Shape</p>
          <div className="flex gap-3">
            {([['Flat', flatRouterBitImg], ['Ball', roundRouterBitImg], ['V', vCarveBitImg]] as [RouterBitShape, string][]).map(
              ([shape, img]) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => setField({ toolShape: shape })}
                  className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-2 transition ${
                    machiningSettings.toolShape === shape
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-border/60'
                  }`}
                >
                  <img src={img} alt={shape} className="h-10 w-10 object-contain" />
                  <span className="text-xs text-foreground">{shape}</span>
                </button>
              ),
            )}
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="grid gap-1">
            <p className="text-xs text-muted-foreground">Passes</p>
            <div className="inline-flex h-8 items-center rounded-md border border-border bg-content1 px-2">
              <input
                type="text"
                inputMode="numeric"
                className="w-10 border-0 bg-transparent px-0 text-sm text-foreground outline-none"
                value={String(machiningSettings.passCount)}
                onChange={(e) => {
                  const v = Math.max(1, Math.round(Number(e.target.value)))
                  if (Number.isFinite(v)) setField({ passCount: v })
                }}
              />
              <span className="pl-1 text-xs text-muted-foreground">x</span>
            </div>
          </div>
          {depthPerPass !== null && (
            <div className="flex h-8 flex-1 items-center justify-end gap-1 text-sm text-foreground">
              <span className="font-medium">{depthPerPass} mm</span>
              <span className="text-xs text-muted-foreground">/ pass of {maxCutDepth} mm</span>
            </div>
          )}
        </div>
      </section>

      {/* Advanced */}
      <section className="rounded-md border border-border bg-content1 px-3 py-3">
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left"
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          <span className="text-xs text-muted-foreground">{advancedOpen ? '▾' : '▸'}</span>
          <p className="text-sm font-medium text-foreground">Advanced</p>
        </button>
        {advancedOpen && (
          <div className="mt-3 flex flex-wrap gap-3">
            <NumberField label="Max Stepdown" unit="mm" value={machiningSettings.maxStepdown}
              onChange={(v) => setField({ maxStepdown: v })} />
            <NumberField label="Stepover" unit="mm" value={machiningSettings.stepover}
              onChange={(v) => setField({ stepover: v })} />
            <NumberField label="Cut Feed" unit="mm/min" value={machiningSettings.cutFeedrate}
              onChange={(v) => setField({ cutFeedrate: v })} />
            <NumberField label="Plunge Feed" unit="mm/min" value={machiningSettings.plungeFeedrate}
              onChange={(v) => setField({ plungeFeedrate: v })} />
            <NumberField label="Travel Z" unit="mm" value={machiningSettings.travelZ}
              onChange={(v) => setField({ travelZ: v })} />
            <NumberField label="Cut Z" unit="mm" value={machiningSettings.cutZ}
              onChange={(v) => setField({ cutZ: v })} />
            <NumberField label="Machine W" unit="mm" value={machiningSettings.machineWidth}
              onChange={(v) => setField({ machineWidth: v })} />
            <NumberField label="Machine H" unit="mm" value={machiningSettings.machineHeight}
              onChange={(v) => setField({ machineHeight: v })} />
          </div>
        )}
      </section>

      {/* Artboard position info */}
      <section className="space-y-3">
        <SectionHeading title="Artboard" />
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div className="rounded-md border border-border bg-content1 px-3 py-2">
            Offset X: {artboard.x}
          </div>
          <div className="rounded-md border border-border bg-content1 px-3 py-2">
            Offset Y: {artboard.y}
          </div>
        </div>
        <div className="rounded-md border border-border bg-content1 px-3 py-3 text-sm text-muted-foreground">
          {selectedStage
            ? 'Artboard selected — drag or resize on canvas.'
            : 'Click the stage to select the artboard.'}
        </div>
      </section>
    </div>
  )
}

function NumberPill({
  label,
  value,
  unit,
  onChange,
}: {
  label: string
  value: number
  unit: string
  onChange: (value: number | null) => void
}) {
  const [editValue, setEditValue] = useState<string | null>(null)

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw)
    if (raw.trim() === '') {
      onChange(null)
    } else if (Number.isFinite(parsed)) {
      onChange(parsed)
    }
    setEditValue(null)
  }

  return (
    <div className="inline-flex h-8 items-center rounded-md border border-border bg-content1 px-2">
      <div className="shrink-0 text-xs text-muted-foreground">{label}</div>
      <input
        type="text"
        inputMode="decimal"
        className="w-12 border-0 bg-transparent px-1.5 text-sm text-foreground outline-none"
        value={editValue ?? String(value)}
        onFocus={(e) => {
          setEditValue(String(value))
          requestAnimationFrame(() => e.target.select())
        }}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') { setEditValue(null); e.currentTarget.blur() }
        }}
      />
      <div className="pl-1 text-xs text-muted-foreground">{unit}</div>
    </div>
  )
}

function NumberField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string
  unit: string
  value: number | null
  onChange: (value: number | null) => void
}) {
  const [editValue, setEditValue] = useState<string | null>(null)

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw)
    if (raw.trim() === '') {
      onChange(null)
    } else if (Number.isFinite(parsed)) {
      onChange(parsed)
    }
    setEditValue(null)
  }

  return (
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="inline-flex h-8 items-center rounded-md border border-border bg-content1 px-2">
        <input
          type="text"
          inputMode="decimal"
          placeholder="—"
          className="w-14 border-0 bg-transparent px-0 text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
          value={editValue ?? (value !== null ? String(value) : '')}
          onFocus={(e) => {
            setEditValue(value !== null ? String(value) : '')
            requestAnimationFrame(() => e.target.select())
          }}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') { setEditValue(null); e.currentTarget.blur() }
          }}
        />
        <div className="pl-1 text-xs text-muted-foreground">{unit}</div>
      </div>
    </div>
  )
}

function SectionHeading({
  title,
  rightContent,
}: {
  title: string
  rightContent?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {rightContent ? <div>{rightContent}</div> : null}
    </div>
  )
}

interface CutDepthGroup {
  key: string
  cutDepth: number
  nodeIds: string[]
  partCount: number
  fillMode?: NormalizedCutDepthFill
  mixedFill: boolean
  color: string
}

function CutDepthGroupsList({
  groups,
  showSelectButton = false,
  onDepthChange,
  onFillModeChange,
  onSelectGroup,
}: {
  groups: CutDepthGroup[]
  showSelectButton?: boolean
  onDepthChange: (ids: string[], value: number) => void
  onFillModeChange: (ids: string[], value: EngraveType) => void
  onSelectGroup?: (ids: string[]) => void
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-content1 px-3 py-3 text-sm text-muted-foreground">
        No assigned parts yet.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.key} className="rounded-md border border-border bg-content1 p-3">
          <div className="flex items-start gap-3">
            <span
              className="mt-1 h-4 w-4 shrink-0 rounded-[4px]"
              style={{ backgroundColor: group.color }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{formatCutDepth(group.cutDepth)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {group.partCount} {group.partCount === 1 ? 'part' : 'parts'}
              </p>
            </div>
            {showSelectButton && onSelectGroup ? (
              <Button size="sm" variant="secondary" onPress={() => onSelectGroup(group.nodeIds)}>
                Select
              </Button>
            ) : null}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <NumberField
              label="Depth"
              unit="mm"
              value={group.cutDepth}
              onChange={(value) => {
                if (value !== null && value >= 0) {
                  onDepthChange(group.nodeIds, value)
                }
              }}
            />

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Part fill</p>
              <div className="flex gap-1.5">
                {ENGRAVE_TYPES.map((type) => {
                  const isActive = group.fillMode === type && !group.mixedFill
                  return (
                    <Button
                      key={type}
                      size="sm"
                      variant={isActive ? 'primary' : 'secondary'}
                      onPress={() => onFillModeChange(group.nodeIds, type)}
                    >
                      {ENGRAVE_LABEL[type]}
                    </Button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {group.mixedFill
                  ? 'Mixed fill types in this depth group.'
                  : `Current fill: ${group.fillMode ? ENGRAVE_LABEL[group.fillMode] : 'Not set'}.`}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function buildCutDepthGroups(nodesById: Record<string, CanvasNode>): CutDepthGroup[] {
  const groups = new Map<string, { cutDepth: number; nodeIds: string[]; fillModes: Set<NormalizedCutDepthFill> }>()

  Object.values(nodesById).forEach((node) => {
    if (isGroupNode(node)) {
      return
    }

    const cutDepth = node.cncMetadata?.cutDepth
    if (cutDepth === undefined) {
      return
    }

    const key = cutDepth.toFixed(3)
    const fillMode = normalizeEngraveType(node.cncMetadata?.engraveType)
    const existing = groups.get(key)

    if (existing) {
      existing.nodeIds.push(node.id)
      if (fillMode) {
        existing.fillModes.add(fillMode)
      }
      return
    }

    groups.set(key, {
      cutDepth,
      nodeIds: [node.id],
      fillModes: fillMode ? new Set([fillMode]) : new Set(),
    })
  })

  return Array.from(groups.values())
    .sort((a, b) => a.cutDepth - b.cutDepth)
    .map((group) => {
      const [fillMode] = Array.from(group.fillModes)

      return {
        key: `${group.cutDepth.toFixed(3)}-${fillMode ?? 'unset'}`,
        cutDepth: group.cutDepth,
        nodeIds: group.nodeIds,
        partCount: group.nodeIds.length,
        fillMode,
        mixedFill: group.fillModes.size > 1,
        color: depthToColor(group.cutDepth),
      }
    })
}

function formatCutDepth(depth: number): string {
  return `${depth.toFixed(2)} mm`
}

function depthToColor(depth: number): string {
  const ratio = Math.min(1, Math.max(0, depth / 20))
  const hue = 60 - ratio * 60
  return `hsl(${hue}, 90%, 55%)`
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
