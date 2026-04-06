import { useState, useCallback } from "react"
import { generateEngravingJob, type JobProgress, type GenerateJobResponse } from "@svg2gcode/bridge"

import { useEditorStore } from "../store"
import { initBridge } from "../lib/bridge"
import { prepareGenerationInputs } from "../lib/bridgeAdapter"

export interface GcodeGenerationState {
  isGenerating: boolean
  progress: JobProgress | null
  result: GenerateJobResponse | null
  error: string | null
}

export function useGcodeGeneration() {
  const [state, setState] = useState<GcodeGenerationState>({
    isGenerating: false,
    progress: null,
    result: null,
    error: null,
  })

  const generate = useCallback(async () => {
    setState({ isGenerating: true, progress: null, result: null, error: null })

    try {
      // Ensure WASM is ready and get base settings
      const baseSettings = await initBridge()

      const { nodesById, rootIds, artboard, machiningSettings } = useEditorStore.getState()

      const request = await prepareGenerationInputs(
        nodesById,
        rootIds,
        artboard,
        machiningSettings,
        baseSettings,
      )

      const result = await generateEngravingJob(request, (progress) => {
        setState((prev) => ({ ...prev, progress }))
      })

      setState({ isGenerating: false, progress: null, result, error: null })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : "GCode generation failed"
      setState({ isGenerating: false, progress: null, result: null, error: message })
      return null
    }
  }, [])

  const downloadGcode = useCallback((gcode: string, filename = "output.gcode") => {
    const blob = new Blob([gcode], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }, [])

  const reset = useCallback(() => {
    setState({ isGenerating: false, progress: null, result: null, error: null })
  }, [])

  return {
    ...state,
    generate,
    downloadGcode,
    reset,
  }
}
