export {
  parseGcodeProgram,
  sampleProgramAtDistance,
  type ParsedSegment,
  type ParsedEvent,
  type ParsedProgram,
  type PlaybackSample,
  type OperationSpan,
  type MotionKind,
} from "./parse-gcode";

export {
  clipSegmentToDistance,
  splitSegmentAtDistance,
} from "./playback-segment";

export {
  buildHeightField,
  type HeightField,
} from "./height-field";
