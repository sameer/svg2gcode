import { useEditorStore } from '../../store'

const SPEED_OPTIONS = [0.5, 1, 2, 5, 10] as const

export function PlaybackTimeline() {
  const playbackDistance = useEditorStore((s) => s.preview.playbackDistance)
  const isPlaying = useEditorStore((s) => s.preview.isPlaying)
  const loopPlayback = useEditorStore((s) => s.preview.loopPlayback)
  const playbackRate = useEditorStore((s) => s.preview.playbackRate)
  const totalDistance = useEditorStore((s) => s.preview.parsedProgram?.totalDistance ?? 0)
  const operationSpans = useEditorStore((s) => s.preview.parsedProgram?.operationSpans ?? [])
  const togglePlayback = useEditorStore((s) => s.togglePlayback)
  const setPlaybackDistance = useEditorStore((s) => s.setPlaybackDistance)
  const setLoopPlayback = useEditorStore((s) => s.setLoopPlayback)
  const setPlaybackRate = useEditorStore((s) => s.setPlaybackRate)
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying)

  const progressPercent = totalDistance > 0 ? (playbackDistance / totalDistance) * 100 : 0

  return (
    <div className="flex items-center gap-3 border-t border-white/10 bg-[rgba(19,19,23,0.95)] px-4 py-2.5 text-white">
      {/* Play/Pause */}
      <button
        type="button"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/8 text-sm hover:bg-white/14"
        onClick={togglePlayback}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      {/* Reset */}
      <button
        type="button"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/8 text-xs hover:bg-white/14"
        onClick={() => {
          setIsPlaying(false)
          setPlaybackDistance(0)
        }}
      >
        ⏮
      </button>

      {/* Slider */}
      <div className="relative min-w-0 flex-1">
        {/* Operation span markers */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1">
          {operationSpans.map((span) => {
            const left = totalDistance > 0 ? (span.startDistance / totalDistance) * 100 : 0
            const width = totalDistance > 0 ? ((span.endDistance - span.startDistance) / totalDistance) * 100 : 0
            return (
              <div
                key={span.operationId}
                className="absolute top-0 h-full rounded-full opacity-60"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundColor: span.color || '#4aa8ff',
                }}
              />
            )
          })}
        </div>

        <input
          type="range"
          min={0}
          max={totalDistance}
          step={totalDistance / 1000 || 1}
          value={playbackDistance}
          onChange={(e) => {
            setIsPlaying(false)
            setPlaybackDistance(Number(e.target.value))
          }}
          className="relative z-10 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
          style={{
            background: `linear-gradient(to right, rgba(255,255,255,0.35) ${progressPercent}%, rgba(255,255,255,0.1) ${progressPercent}%)`,
          }}
        />
      </div>

      {/* Distance display */}
      <span className="shrink-0 text-xs tabular-nums text-white/60">
        {formatDistance(playbackDistance)} / {formatDistance(totalDistance)}
      </span>

      {/* Loop toggle */}
      <button
        type="button"
        className={`flex h-7 shrink-0 items-center rounded-full border px-2.5 text-xs transition ${
          loopPlayback
            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
            : 'border-white/15 bg-white/8 text-white/50'
        }`}
        onClick={() => setLoopPlayback(!loopPlayback)}
      >
        Loop
      </button>

      {/* Speed selector */}
      <select
        value={playbackRate}
        onChange={(e) => setPlaybackRate(Number(e.target.value))}
        className="h-7 shrink-0 rounded-full border border-white/15 bg-white/8 px-2 text-xs text-white outline-none"
      >
        {SPEED_OPTIONS.map((speed) => (
          <option key={speed} value={speed * 60}>
            {speed}x
          </option>
        ))}
      </select>
    </div>
  )
}

function formatDistance(mm: number): string {
  if (mm >= 1000) return `${(mm / 1000).toFixed(1)}m`
  return `${mm.toFixed(0)}mm`
}
