export type Mode = "style" | "recreate" | "reenact";
export type SubjectInput = {
  subjectImage: string;
  basePrompt: string; // User task instruction; keep the field name for saved jobs.
  promptSourceJobId?: string;
};
export type Preferences = { token: string; mode: Mode };
export type Selection = {
  id: string;
  projectId?: string;
  sourceUrl: string;
  image?: string;
  capture?: "original" | "screenshot";
  stage?: string;
  error?: string;
  jobId?: string;
  reenact?: SubjectInput; // Shared two-image input; retain the saved field name.
  subjectError?: string;
  generationSubjectImage?: string;
};
export type Result = {
  title: string;
  observations: string[];
  promptZh: string;
  promptEn: string;
  negativePrompt: string;
  uncertainties: string[];
};
export type Job = {
  id: string;
  projectId?: string;
  imageAsset?: string;
  subjectAsset?: string;
  mode: Mode;
  status: "running" | "completed" | "failed" | "cancelled";
  stage: string;
  createdAt: string;
  sourceUrl: string;
  capture: "original" | "screenshot";
  result?: Result;
  error?: string;
  threadId?: string;
  model?: string;
  reenact?: Omit<SubjectInput, "subjectImage">;
  generations?: Generation[];
};
export type ProjectSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceUrl: string;
  capture: "original" | "screenshot";
  jobCount: number;
  busy: boolean;
  revision?: string;
  cover?: { jobId: string; generationId: string; imageAsset?: string };
  modes: Partial<Record<Mode, { status: string; hasImage: boolean }>>;
};
export type Project = ProjectSummary & { jobs: Job[] };
export type ProjectPage = { items: ProjectSummary[]; total: number; page: number; pageSize: number; revision: string };
export type AspectRatio = { width: number; height: number };
export type Generation = {
  id: string;
  imageAsset?: string;
  subjectAsset?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  stage: string;
  createdAt: string;
  language: "zh" | "en";
  aspectRatio?: AspectRatio;
  prompt: string;
  negativePrompt: string;
  threadId?: string;
  model?: string;
  extension?: "png" | "jpeg" | "webp";
  subjectExtension?: "png" | "jpeg" | "webp";
  revisedPrompt?: string;
  error?: string;
};
export type ImageTarget = {
  src: string;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
  };
};

export type ModelCatalog = {
  accountLabel?: string;
  selected: string | null;
  verifiedAt?: string;
  models: { model: string; label: string; isDefault: boolean; status: "verified" | "unverified" | "unavailable" }[];
  verification?: { model: string; status: "running" | "completed" | "failed"; error?: string };
};
