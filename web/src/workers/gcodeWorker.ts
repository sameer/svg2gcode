/// <reference lib="webworker" />

import { generateEngravingJob, type GenerateJobRequest, type JobProgress } from "@svg2gcode/bridge"

import { initBridge } from "../lib/bridge"

type GcodeWorkerRequest = {
  type: "generate"
  jobId: number
  request: GenerateJobRequest
}

type GcodeWorkerResponse =
  | { type: "progress"; jobId: number; progress: JobProgress }
  | { type: "result"; jobId: number; result: Awaited<ReturnType<typeof generateEngravingJob>> }
  | { type: "error"; jobId: number; error: string }

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope

workerScope.onmessage = async (event: MessageEvent<GcodeWorkerRequest>) => {
  const message = event.data
  if (message.type !== "generate") return

  try {
    await initBridge()
    const result = await generateEngravingJob(message.request, (progress) => {
      const response: GcodeWorkerResponse = {
        type: "progress",
        jobId: message.jobId,
        progress,
      }
      workerScope.postMessage(response)
    })

    const response: GcodeWorkerResponse = {
      type: "result",
      jobId: message.jobId,
      result,
    }
    workerScope.postMessage(response)
  } catch (error) {
    const response: GcodeWorkerResponse = {
      type: "error",
      jobId: message.jobId,
      error: error instanceof Error ? error.message : "GCode generation failed",
    }
    workerScope.postMessage(response)
  }
}
