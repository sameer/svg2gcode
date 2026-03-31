import init, {
  default_settings as wasmDefaultSettings,
  generate_engraving_job as wasmGenerateEngravingJob,
  prepare_svg_document as wasmPrepareSvgDocument,
} from "@/wasm/pkg/svg2gcode_wasm";

import type {
  GenerateJobRequest,
  GenerateJobResponse,
  PreparedSvgDocument,
  Settings,
} from "@/lib/types";

let wasmReadyPromise: Promise<void> | null = null;

interface WasmEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function ensureWasmReady() {
  if (!wasmReadyPromise) {
    wasmReadyPromise = init().then(() => undefined);
  }

  await wasmReadyPromise;
}

export async function loadDefaultSettings() {
  await ensureWasmReady();
  return unwrapEnvelope<Settings>(wasmDefaultSettings());
}

export async function prepareSvgDocument(svg: string) {
  await ensureWasmReady();
  return unwrapEnvelope<PreparedSvgDocument>(wasmPrepareSvgDocument(svg));
}

export async function generateEngravingJob(request: GenerateJobRequest) {
  await ensureWasmReady();
  return unwrapEnvelope<GenerateJobResponse>(
    wasmGenerateEngravingJob(JSON.stringify(request)),
  );
}

function unwrapEnvelope<T>(payload: string) {
  const parsed = JSON.parse(payload) as WasmEnvelope<T>;
  if (!parsed.ok || parsed.data === undefined) {
    throw new Error(parsed.error ?? "Unknown WASM error");
  }

  return parsed.data;
}
