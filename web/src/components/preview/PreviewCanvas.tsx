import { useRef, useEffect } from 'react'
import * as THREE from 'three'
import { sampleProgramAtDistance } from '@svg2gcode/bridge/viewer'

import { useEditorStore } from '../../store'
import { useThreeScene } from './useThreeScene'
import { clearGroup, createLighting, createGrid, createToolMarker, createActivePathLine } from './sceneHelpers'
import { createStockMeshLayers } from './stockMesh'
import { createMergedSweepMeshes } from './sweepMesh'
import { buildToolpathLines, updateDrawRange, type ToolpathLineData } from './toolpathLines'
import type { ToolpathGroup, StockBounds } from '../../types/preview'
import type { ToolMarker } from './sceneHelpers'

export function PreviewCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)

  const cameraType = useEditorStore((s) => s.preview.cameraType)
  const parsedProgram = useEditorStore((s) => s.preview.parsedProgram)
  const toolpaths = useEditorStore((s) => s.preview.toolpaths)
  const stockBounds = useEditorStore((s) => s.preview.stockBounds)
  const previewSnapshot = useEditorStore((s) => s.preview.previewSnapshot)
  const showStock = useEditorStore((s) => s.preview.showStock)
  const showRapidMoves = useEditorStore((s) => s.preview.showRapidMoves)
  const showSvgOverlay = useEditorStore((s) => s.preview.showSvgOverlay)

  const { sceneRef, requestRender } = useThreeScene(containerRef, cameraType)

  // Refs for mutable scene objects
  const toolMarkerRef = useRef<ToolMarker | null>(null)
  const activePathLineRef = useRef<THREE.Line | null>(null)
  const toolpathLineDataRef = useRef<ToolpathLineData | null>(null)

  // Set up lighting and grid on first mount or when material size changes
  useEffect(() => {
    const state = sceneRef.current
    if (!state || !previewSnapshot) return

    clearGroup(state.lightGroup)
    clearGroup(state.gridGroup)

    state.lightGroup.add(createLighting())

    const grid = createGrid(previewSnapshot.material_width, previewSnapshot.material_height)
    state.gridGroup.add(grid)

    // Position camera to look at the material center
    const cx = previewSnapshot.material_width / 2
    const cy = previewSnapshot.material_height / 2
    const maxDim = Math.max(previewSnapshot.material_width, previewSnapshot.material_height)
    state.controls.target.set(cx, cy, -previewSnapshot.material_thickness / 2)
    state.perspectiveCamera.position.set(cx + maxDim * 0.3, cy - maxDim * 0.6, maxDim * 0.5)
    state.orthographicCamera.position.set(cx + maxDim * 0.3, cy - maxDim * 0.6, maxDim * 0.5)
    state.controls.update()

    requestRender()
  }, [sceneRef, previewSnapshot, requestRender])

  // Build tool marker
  useEffect(() => {
    const state = sceneRef.current
    if (!state || !previewSnapshot) return

    clearGroup(state.toolMarkerGroup)

    const marker = createToolMarker(previewSnapshot.tool_diameter / 2)
    state.toolMarkerGroup.add(marker.group)
    toolMarkerRef.current = marker

    const activeLine = createActivePathLine()
    state.toolMarkerGroup.add(activeLine)
    activePathLineRef.current = activeLine

    requestRender()
  }, [sceneRef, previewSnapshot, requestRender])

  // Build stock/sweep meshes when toolpaths change
  useEffect(() => {
    const state = sceneRef.current
    if (!state || !toolpaths || !stockBounds || !previewSnapshot) return

    clearGroup(state.stockGroup)
    clearGroup(state.sweepGroup)

    const stockMesh = createStockMeshLayers(
      stockBounds,
      toolpaths,
      previewSnapshot.material_thickness,
    )
    state.stockGroup.add(stockMesh)

    const sweepMesh = createMergedSweepMeshes(toolpaths)
    state.sweepGroup.add(sweepMesh)

    requestRender()
  }, [sceneRef, toolpaths, stockBounds, previewSnapshot, requestRender])

  // Toggle stock/sweep visibility
  useEffect(() => {
    const state = sceneRef.current
    if (!state) return
    state.stockGroup.visible = showStock
    state.sweepGroup.visible = !showStock
    requestRender()
  }, [sceneRef, showStock, requestRender])

  // Build toolpath line geometries
  useEffect(() => {
    const state = sceneRef.current
    if (!state || !parsedProgram) return

    clearGroup(state.toolpathGroup)

    const lineData = buildToolpathLines(parsedProgram.segments, showRapidMoves)
    state.toolpathGroup.add(lineData.mesh)
    toolpathLineDataRef.current = lineData

    requestRender()
  }, [sceneRef, parsedProgram, showRapidMoves, requestRender])

  // SVG overlay visibility
  useEffect(() => {
    const state = sceneRef.current
    if (!state) return
    state.overlayGroup.visible = showSvgOverlay
    requestRender()
  }, [sceneRef, showSvgOverlay, requestRender])

  // Playback animation loop
  useEffect(() => {
    const state = sceneRef.current
    if (!state) return

    let lastTime = 0
    let accumulator = 0

    const animate = (time: number) => {
      const { preview } = useEditorStore.getState()

      if (preview.isPlaying && preview.parsedProgram && preview.parsedProgram.totalDistance > 0) {
        const delta = lastTime === 0 ? 0 : (time - lastTime) / 1000
        accumulator += delta * preview.playbackRate

        if (accumulator >= 0.1) {
          let nextDistance = preview.playbackDistance + accumulator
          accumulator = 0

          if (nextDistance >= preview.parsedProgram.totalDistance) {
            if (preview.loopPlayback) {
              nextDistance = nextDistance % preview.parsedProgram.totalDistance
            } else {
              nextDistance = preview.parsedProgram.totalDistance
              useEditorStore.getState().setIsPlaying(false)
            }
          }

          useEditorStore.getState().setPlaybackDistance(nextDistance)
        }
      }

      lastTime = time

      // Update tool marker position
      if (preview.parsedProgram && toolMarkerRef.current) {
        const sample = sampleProgramAtDistance(preview.parsedProgram, preview.playbackDistance)
        const marker = toolMarkerRef.current

        if (sample.segment && preview.playbackDistance > 0) {
          marker.group.visible = true
          marker.group.position.set(sample.position.x, sample.position.y, sample.position.z)
        } else {
          marker.group.visible = false
        }
      }

      // Update toolpath draw range
      if (toolpathLineDataRef.current) {
        updateDrawRange(toolpathLineDataRef.current, preview.playbackDistance)
      }

      requestRender()
      requestAnimationFrame(animate)
    }

    const id = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(id)
  }, [sceneRef, requestRender])

  return <div ref={containerRef} className="h-full w-full" />
}
