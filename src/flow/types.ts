import type { GFlowJob } from "../jobs/schema.js";

export interface FlowArtifact {
  path: string;
  metadataPath: string;
}

export interface FlowJobResult {
  jobId: string;
  artifacts: FlowArtifact[];
  flowUrl: string;
}

export interface FlowAutomationRunInput {
  job: GFlowJob;
  outDir: string;
}

export interface FlowAutomation {
  runJob(input: FlowAutomationRunInput): Promise<FlowJobResult>;
}
