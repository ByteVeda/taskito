import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import {
  ArchitectureStack,
  CrashRecoveryTimeline,
  DispatchSequence,
  EntityRelations,
  EntitySchema,
  HowItWorks,
  JobStateMachine,
  ResourcePipeline,
  SchedulerPollLoop,
  WorkerDispatch,
  WorkerPool,
} from "./animated";
import { DiagramCarousel, DiagramSlide } from "./diagram-carousel";
import { Mermaid } from "./mermaid";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Mermaid,
    DiagramCarousel,
    DiagramSlide,
    ArchitectureStack,
    CrashRecoveryTimeline,
    DispatchSequence,
    EntityRelations,
    EntitySchema,
    HowItWorks,
    JobStateMachine,
    ResourcePipeline,
    SchedulerPollLoop,
    WorkerDispatch,
    WorkerPool,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
