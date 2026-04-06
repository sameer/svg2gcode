import { useState } from 'react'
import { Button, ButtonGroup, Dropdown, Input } from '@heroui/react'

import { AppIcon, Icons } from '../lib/icons'
import { useEditorStore } from '../store'
import type { CanvasNode, GroupNode } from '../types/editor'

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(' ')
}

const NODE_TYPE_LABEL: Record<string, string> = {
  group: 'group',
  rect: 'rect',
  circle: 'circle',
  line: 'line',
  path: 'path',
}

interface LayerTreeProps {
  projectName: string
  onProjectNameChange: (name: string) => void
  onImportSvg: () => void
  onExportProject: () => void
  onSelectMaterial: () => void
}

export function LayerTree({
  projectName,
  onProjectNameChange,
  onImportSvg,
  onExportProject,
  onSelectMaterial,
}: LayerTreeProps) {
  const nodesById = useEditorStore((s) => s.nodesById)
  const rootIds = useEditorStore((s) => s.rootIds)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const selectOne = useEditorStore((s) => s.selectOne)
  const toggleSelection = useEditorStore((s) => s.toggleSelection)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const filteredRootIds = rootIds.filter((id) => {
    const node = nodesById[id]
    if (!node) return false
    if (!query.trim()) return true
    return matchesQuery(node, nodesById, query.toLowerCase())
  })

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="text-xl font-bold text-foreground">Engrav Studio</div>
          <Button isIconOnly size="sm" variant="secondary" onPress={onSelectMaterial}>
            <AppIcon icon={Icons.layers} className="h-4 w-4" />
          </Button>
        </div>

        <Input
          aria-label="Project name"
          className="mt-4"
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
        />

        <ButtonGroup className="mt-4 w-full" variant="secondary">
          <Button className="flex-1 justify-start" onPress={onImportSvg}>
            <AppIcon icon={Icons.fileUpload} className="h-4 w-4" />
            Import SVG
          </Button>
          <Dropdown>
            <Button isIconOnly aria-label="More options">
              <ButtonGroup.Separator />
              <AppIcon icon={Icons.chevronDown} className="h-3.5 w-3.5" />
            </Button>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu onAction={(key) => {
                if (key === 'export-project') onExportProject()
              }}>
                <Dropdown.Item id="export-project">
                  Export Project
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </ButtonGroup>
      </div>

      <div className="border-b border-border px-4 py-3">
        <Input
          aria-label="Search layers"
          placeholder="Search art objects and layers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {filteredRootIds.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-content1 px-3 py-3 text-sm text-muted-foreground">
            {rootIds.length === 0
              ? 'Drop an SVG or use Import SVG to start.'
              : 'No results match your search.'}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRootIds.map((id) => {
              const node = nodesById[id]
              if (!node) return null
              const isGroup = node.type === 'group'
              const childCount = isGroup ? (node as GroupNode).childIds.length : 0
              const selected = selectedIds.includes(id)
              const isCollapsed = collapsed[id] ?? false

              return (
                <div key={id} className="rounded-lg border border-border bg-content1">
                  <button
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-3 py-3 text-left transition hover:bg-content2',
                      selected && 'bg-content3',
                    )}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey) {
                        toggleSelection(id)
                      } else {
                        selectOne(id)
                      }
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {isGroup ? (
                        <span
                          role="button"
                          tabIndex={0}
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-content2"
                          onClick={(e) => {
                            e.stopPropagation()
                            setCollapsed((c) => ({ ...c, [id]: !isCollapsed }))
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              e.stopPropagation()
                              setCollapsed((c) => ({ ...c, [id]: !isCollapsed }))
                            }
                          }}
                        >
                          {isCollapsed
                            ? <AppIcon icon={Icons.chevronRight} className="h-4 w-4" />
                            : <AppIcon icon={Icons.chevronDown} className="h-4 w-4" />}
                        </span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center" />
                      )}
                      <AppIcon icon={Icons.picture} className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate text-sm font-medium">{node.name || id}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {isGroup ? `${childCount} parts` : NODE_TYPE_LABEL[node.type]}
                    </span>
                  </button>

                  {isGroup && !isCollapsed ? (
                    <div className="border-t border-border px-1 py-1">
                      {(node as GroupNode).childIds.map((childId) => (
                        <TreeNode
                          key={childId}
                          nodeId={childId}
                          nodesById={nodesById}
                          selectedIds={selectedIds}
                          query={query}
                          depth={1}
                          onSelect={(id, additive) => {
                            if (additive) toggleSelection(id)
                            else selectOne(id)
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function TreeNode({
  nodeId,
  nodesById,
  selectedIds,
  query,
  depth,
  onSelect,
}: {
  nodeId: string
  nodesById: Record<string, CanvasNode>
  selectedIds: string[]
  query: string
  depth: number
  onSelect: (id: string, additive: boolean) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const node = nodesById[nodeId]
  if (!node) return null

  const isGroup = node.type === 'group'
  const childIds = isGroup ? (node as GroupNode).childIds : []
  const isSelected = selectedIds.includes(nodeId)
  const label = node.name || nodeId
  const typeTag = NODE_TYPE_LABEL[node.type]

  const normalizedQuery = query.trim().toLowerCase()
  const matchesSelf = !normalizedQuery || label.toLowerCase().includes(normalizedQuery) || node.type.includes(normalizedQuery)
  const hasMatchingChildren = isGroup && childIds.some((cid) => {
    const child = nodesById[cid]
    return child && matchesQuery(child, nodesById, normalizedQuery)
  })

  if (!matchesSelf && !hasMatchingChildren) return null

  const cncColor = node.cncMetadata?.cutDepth != null
    ? depthToColor(node.cncMetadata.cutDepth)
    : null

  return (
    <div className="space-y-0.5">
      <button
        className={cn(
          'flex w-full items-center justify-between rounded-md py-2 pr-3 text-left hover:bg-content2',
          isSelected && 'bg-content3',
        )}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={(e) => onSelect(nodeId, e.metaKey || e.ctrlKey || e.shiftKey)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {isGroup ? (
            <span
              role="button"
              tabIndex={0}
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation()
                setCollapsed((c) => !c)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  setCollapsed((c) => !c)
                }
              }}
            >
              {collapsed
                ? <AppIcon icon={Icons.chevronRight} className="h-3.5 w-3.5" />
                : <AppIcon icon={Icons.chevronDown} className="h-3.5 w-3.5" />}
            </span>
          ) : null}
          {cncColor ? (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cncColor }} />
          ) : null}
          <span className="truncate text-sm">{label}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{typeTag}</span>
      </button>

      {isGroup && !collapsed
        ? childIds.map((cid) => (
            <TreeNode
              key={cid}
              nodeId={cid}
              nodesById={nodesById}
              selectedIds={selectedIds}
              query={query}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  )
}

function matchesQuery(node: CanvasNode, nodesById: Record<string, CanvasNode>, q: string): boolean {
  const label = (node.name || node.id).toLowerCase()
  if (label.includes(q) || node.type.includes(q)) return true
  if (node.type === 'group') {
    return (node as GroupNode).childIds.some((cid) => {
      const child = nodesById[cid]
      return child ? matchesQuery(child, nodesById, q) : false
    })
  }
  return false
}

function depthToColor(depth: number): string {
  const t = Math.min(1, Math.max(0, depth / 20))
  const hue = 60 - t * 60 // yellow (60) → red (0)
  return `hsl(${hue}, 90%, 55%)`
}
