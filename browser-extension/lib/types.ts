export type Mode = "style" | "recreate" | "reenact";
export type SubjectInput = {
  subjectImage: string;
  basePrompt: string; // User task instruction; keep the field name for saved jobs.
  promptSourceJobId?: string;
};
export type Preferences = { token: string; mode: Mode };
export type Selection = {
  id: string;
  sourceUrl: string;
  image?: string;
  capture?: "original" | "screenshot";
  stage?: string;
  error?: string;
  jobId?: string;
  reenact?: SubjectInput; // Shared two-image input; retain the saved field name.
  subjectError?: string;
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
  mode: Mode;
  status: "running" | "completed" | "failed" | "cancelled";
  stage: string;
  createdAt: string;
  sourceUrl: string;
  capture: "original" | "screenshot";
  result?: Result;
  error?: string;
  threadId?: string;
  reenact?: Omit<SubjectInput, "subjectImage">;
  generations?: Generation[];
};
export type Generation = {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  stage: string;
  createdAt: string;
  language: "zh" | "en";
  prompt: string;
  negativePrompt: string;
  threadId?: string;
  extension?: "png" | "jpeg" | "webp";
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
