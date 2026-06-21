// Single barrel for every diagram component used in MDX. The architecture
// diagrams below are prototype-faithful ports (arch.js + arch-*.html); the
// remaining ones are re-exported from their existing homes so MDX imports one place.

// Still rendered by the existing implementations (no prototype counterpart).
export {
  DispatchSequence,
  EntityRelations,
  EntitySchema,
} from "@/components/animated";
export { DiagramCarousel, DiagramSlide } from "@/components/diagram-carousel";
export { Mermaid } from "@/components/mermaid";
export { ArchitectureStack, ResourcePipeline } from "./arch-stack";
export { CrashRecoveryTimeline } from "./failure-timeline";
export { JobStateMachine } from "./lifecycle-graph";
export { MeshDemo } from "./mesh-demo";
export { SchedulerPollLoop } from "./poll-cycle";
export { WorkerDispatch } from "./worker-fork";
