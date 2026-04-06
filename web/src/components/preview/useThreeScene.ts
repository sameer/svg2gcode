/**
 * React hook that manages the full Three.js scene lifecycle:
 * renderer, scene, cameras, OrbitControls, lighting, resize, render loop.
 */

import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { CameraType } from '../../types/preview'

export interface SceneState {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  perspectiveCamera: THREE.PerspectiveCamera
  orthographicCamera: THREE.OrthographicCamera
  controls: OrbitControls
  activeCamera: THREE.Camera

  // Scene groups for organized rendering
  lightGroup: THREE.Group
  gridGroup: THREE.Group
  stockGroup: THREE.Group
  sweepGroup: THREE.Group
  toolpathGroup: THREE.Group
  overlayGroup: THREE.Group
  toolMarkerGroup: THREE.Group
}

export function useThreeScene(
  containerRef: React.RefObject<HTMLDivElement | null>,
  cameraType: CameraType,
) {
  const sceneRef = useRef<SceneState | null>(null)
  const animationIdRef = useRef<number>(0)
  const needsRenderRef = useRef(true)

  // Initialize scene
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(0x232323)
    container.appendChild(renderer.domElement)

    // Scene
    const scene = new THREE.Scene()

    // Cameras
    const perspectiveCamera = new THREE.PerspectiveCamera(55, width / height, 0.1, 10000)
    perspectiveCamera.up.set(0, 0, 1)
    perspectiveCamera.position.set(200, -300, 250)

    const aspect = width / height
    const frustumSize = 400
    const orthographicCamera = new THREE.OrthographicCamera(
      (-frustumSize * aspect) / 2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      10000,
    )
    orthographicCamera.up.set(0, 0, 1)
    orthographicCamera.position.set(200, -300, 250)

    // Controls
    const activeCamera = perspectiveCamera
    const controls = new OrbitControls(activeCamera, renderer.domElement)
    controls.target.set(0, 0, -5)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.addEventListener('change', () => {
      needsRenderRef.current = true
    })

    // Scene groups
    const lightGroup = new THREE.Group()
    const gridGroup = new THREE.Group()
    const stockGroup = new THREE.Group()
    const sweepGroup = new THREE.Group()
    const toolpathGroup = new THREE.Group()
    const overlayGroup = new THREE.Group()
    const toolMarkerGroup = new THREE.Group()

    scene.add(lightGroup, gridGroup, stockGroup, sweepGroup, toolpathGroup, overlayGroup, toolMarkerGroup)

    const state: SceneState = {
      renderer,
      scene,
      perspectiveCamera,
      orthographicCamera,
      controls,
      activeCamera,
      lightGroup,
      gridGroup,
      stockGroup,
      sweepGroup,
      toolpathGroup,
      overlayGroup,
      toolMarkerGroup,
    }
    sceneRef.current = state

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect
        if (w === 0 || h === 0) continue
        renderer.setSize(w, h)

        const asp = w / h
        perspectiveCamera.aspect = asp
        perspectiveCamera.updateProjectionMatrix()

        const fs = 400
        orthographicCamera.left = (-fs * asp) / 2
        orthographicCamera.right = (fs * asp) / 2
        orthographicCamera.top = fs / 2
        orthographicCamera.bottom = -fs / 2
        orthographicCamera.updateProjectionMatrix()

        needsRenderRef.current = true
      }
    })
    resizeObserver.observe(container)

    // Render loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate)
      controls.update()
      if (needsRenderRef.current) {
        renderer.render(scene, state.activeCamera)
        needsRenderRef.current = false
      }
    }
    animate()

    return () => {
      cancelAnimationFrame(animationIdRef.current)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
      sceneRef.current = null
    }
  }, [containerRef])

  // Camera type switching
  useEffect(() => {
    const state = sceneRef.current
    if (!state) return

    const newCamera =
      cameraType === 'orthographic' ? state.orthographicCamera : state.perspectiveCamera

    // Copy position and target from old camera
    newCamera.position.copy(state.activeCamera.position)
    newCamera.lookAt(state.controls.target)
    newCamera.updateProjectionMatrix()

    state.controls.object = newCamera
    state.controls.update()
    state.activeCamera = newCamera
    needsRenderRef.current = true
  }, [cameraType])

  const requestRender = useCallback(() => {
    needsRenderRef.current = true
  }, [])

  return { sceneRef, requestRender }
}
