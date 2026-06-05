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

export interface CharacterSummary {
  name: string;
  thumbnailUrl?: string;
}

export interface CharacterResult {
  name: string;
  thumbnailPath?: string;
  flowUrl: string;
}

export interface CreateCharacterInput {
  prompt: string;
  name: string;
  description?: string;
  voice?: string;
  model?: "nano-banana-2" | "nano-banana-pro";
  preset?: "familiar" | "eccentric" | "wicked" | "fantastical";
  images: string[];
  fromProject: string[];
  project?: string;
  outDir: string;
  timeout?: number;
}

export interface CharacterAutomation {
  createCharacter(input: CreateCharacterInput): Promise<CharacterResult>;
  listCharacters(project?: string): Promise<CharacterSummary[]>;
}

export interface EditMediaInput {
  mediaId: string;
  prompt: string;
  referenceImages: string[];
  fromProject: string[];
  project?: string;
  outDir: string;
  timeout?: number;
}

export interface EditMediaResult {
  mediaId: string;
  artifacts: { path: string; metadataPath: string }[];
  flowUrl: string;
}

export interface ProjectMedia {
  id: string;
  type: "image" | "video";
  src: string;
  name?: string;
}

export interface EditAutomation {
  editMedia(input: EditMediaInput): Promise<EditMediaResult>;
  listProjectMedia(project?: string): Promise<ProjectMedia[]>;
}

export interface ToolSummary { name: string; }
export interface ToolResult { name: string; flowUrl: string; }
export interface CreateToolInput {
  prompt: string;
  name?: string;
  preset?: "image-filter" | "style-morph" | "time-stretcher" | "voice-over";
  project?: string;
}
export interface ToolAutomation {
  createTool(input: CreateToolInput): Promise<ToolResult>;
  listTools(project?: string): Promise<ToolSummary[]>;
  openTool(name: string, project?: string): Promise<void>;
}

export interface AgentSettingsInput {
  confirm?: "always" | "never";
  imageModel?: string;
  imageRatio?: string;
  imageQuantity?: number;
  videoModel?: string;
  videoRatio?: string;
  videoQuantity?: number;
  project?: string;
}
export interface AgentInstructionInput {
  text: string;
  ref?: string;
  project?: string;
}
export interface AgentInstructionSummary { text: string; hasRef: boolean; }
export interface RunAgentInput {
  id: string;
  prompt: string;
  project?: string;
  outDir: string;
  timeout?: number;
}
export interface AgentAutomation {
  runAgent(input: RunAgentInput): Promise<FlowJobResult>;
  applySettings(input: AgentSettingsInput): Promise<void>;
  addInstruction(input: AgentInstructionInput): Promise<void>;
  listInstructions(project?: string): Promise<AgentInstructionSummary[]>;
  clearInstructions(project?: string): Promise<void>;
}
