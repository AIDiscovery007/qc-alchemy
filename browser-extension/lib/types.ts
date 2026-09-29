export type Mode = "style" | "recreate" | "reenact";
export type ReenactInput = {
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
  reenact?: ReenactInput;
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
  reenact?: Omit<ReenactInput, "subjectImage">;
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
