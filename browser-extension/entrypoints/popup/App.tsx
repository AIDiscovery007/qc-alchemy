import { resultDrawers, resultDrawerView } from "../../lib/result-drawer";
import useProjectLibrary from "./useProjectLibrary";
import { useMotion } from "../../lib/use-motion";
import { pollWhileVisible } from "../../lib/visible-poll";
import { createPortal } from "react-dom";
import { normalizeImage } from "../../lib/image";
import NewProject from "../workspace/NewProject";
import PromptEditor from "../workspace/PromptEditor";
import RecentProject from "../workspace/RecentProject";
import ImageInput from "../workspace/ImageInput";
import SettingsCenter from "./SettingsCenter";
import TaskCenter from "./TaskCenter";
import HiddenProjectsToggle from "./HiddenProjectsToggle";
import { useEffect, useReducer, useRef, useState } from "react";
import { query, readState, request, type UiState } from "../../lib/client";
import type { Job, Mode, Project, ProjectSummary, SubjectInput, Selection, MultiSubject } from "../../lib/types";
import ProjectHistory from "./ProjectHistory";
import SubjectForm from "./SubjectForm";
import MultiInputPreview from "./MultiInputPreview";
import TaskInstruction, { defaultInstructions } from "./TaskInstruction";
import MultiSubjectForm from "./MultiSubjectForm";
import LoadingPlaceholder from "./LoadingPlaceholder";
import AsyncAction from "./AsyncAction";
import GenerationPanel from "./GenerationPanel";
import Icon from "./Icon";
import SelectField from "./SelectField";
import ModelSettings from "./ModelSettings";
import InlineHelp from "./InlineHelp";
import { logo } from "../../lib/brand";

const defaults: UiState["preferences"] = { paired: false, mode: "style" };
const laneStatus = (job?: Job) => !job ? "待生成" : job.status === "running" ? "逆向中"
  : job.generations?.some((item) => item.status === "running") ? "生图中"
  : job.status !== "completed" ? "待重试"
  : job.generations?.some((item) => item.status === "completed") ? "提示词 + 图片" : "提示词已就绪";
const modeName = (mode: Mode) => ({ style: "提取风格", recreate: "完整复刻", reenact: "主体重演", "multi-reenact": "多图重演" })[mode];
type PromptDraft = Pick<NonNullable<Job["result"]>, "promptZh" | "promptEn" | "negativePrompt">;

export default function App({ embedded = false, workspace = false }: { embedded?: boolean; workspace?: boolean }) {
  const { reduced } = useMotion();
  const [projectSearchTarget, setProjectSearchTarget] = useState<HTMLDivElement | null>(null);
  const [resultPane, setResultPane] = useState<HTMLElement | null>(null);
  const [generationActions, setGenerationActions] = useState<HTMLDivElement | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [drawers, dispatchDrawer] = useReducer(resultDrawers, {});
  const resultReturn = useRef<HTMLButtonElement>(null);
  const wasDrawerOpen = useRef(false);
  const editor = useRef<HTMLDivElement>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>();
  const [smallSidebar, setSmallSidebar] = useState(() => matchMedia("(max-width: 860px)").matches);
  const sidebarCollapsed = !(sidebarExpanded ?? !smallSidebar);
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 650px)").matches);
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const referenceInput = useRef<HTMLInputElement>(null);
  const [activeCount, setActiveCount] = useState(0);
  const [cliBusy, setCliBusy] = useState(false);
  const [preferences, setPreferences] = useState(defaults);
  const [tokenDraft, setTokenDraft] = useState("");
  const [storedSelection, setSelection] = useState<Selection>();
  const [hiddenProjectIds, setHiddenProjectIds] = useState<string[]>([]);
  const showHidden = !!preferences.showHiddenProjects;
  const visibilityRevision = useRef(0);
  const selection = !showHidden && storedSelection?.projectId && hiddenProjectIds.includes(storedSelection.projectId) ? undefined : storedSelection;
  const [project, setProject] = useState<Project>();
  const projectSnapshot = useRef<Project | undefined>(undefined);
  projectSnapshot.current = project;
  const [dataRevision, setDataRevision] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, Selection>>({});
  const [multiSubjectDrafts, setMultiSubjectDrafts] = useState<Record<string, MultiSubject[]>>({});
  const [swappedSubjectId, setSwappedSubjectId] = useState("");
  const [subjectDrafts, setSubjectDrafts] = useState<Record<string, string>>({});
  const [promptDrafts, setPromptDrafts] = useState<Record<string, PromptDraft>>({});
  const [savingPrompt, setSavingPrompt] = useState("");
  const [referenceErrors, setReferenceErrors] = useState<Record<string, string>>({});
  const [savingMode, setSavingMode] = useState(false);
  const modeRevision = useRef(0);
  const projectRevision = useRef(0);
  const selectionRevision = useRef(0);
  const deletingProjects = useRef(false);
  const [settings, setSettings] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const library = useProjectLibrary(preferences.paired, historyOpen, workspace, dataRevision, showHidden);
  const visibleProject = (item: ProjectSummary) => showHidden || (!item.hidden && !hiddenProjectIds.includes(item.id));
  const recentProjects = library.recent.items.filter(visibleProject);
  const [connected, setConnected] = useState(false);
  const [connectionText, setConnectionText] = useState("尚未连接");
  const [serviceBusy, setServiceBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingCancellations = useRef(new Set<string>());
  const [cancellingJobs, setCancellingJobs] = useState<string[]>([]);
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeProject = project?.id === selection?.projectId ? project : undefined;
  const modeJobs = (mode: Mode) => activeProject?.jobs.filter((item) => item.mode === mode) || [];
  const modeJob = (mode: Mode) => {
    const jobs = modeJobs(mode);
    if (versions[`${activeProject?.id}:${mode}`] === "new") return undefined;
    return jobs.find((item) => item.id === versions[`${activeProject?.id}:${mode}`]) || jobs[0];
  };
  const subjectKey = (mode: Mode) => `${selection?.projectId || selection?.id}:${mode}`;
  const subjectImage = (mode: Mode) => {
    const savedJob = modeJob(mode);
    const saved = savedJob && references[savedJob.id];
    return subjectDrafts[subjectKey(mode)] ?? saved?.generationSubjectImage ?? saved?.reenact?.subjectImage ?? "";
  };
  const instructionKey = (mode: Mode) => `${subjectKey(mode)}:${modeJob(mode)?.id || "new"}`;
  const taskInstruction = (mode: Mode) => {
    const saved = modeJob(mode);
    return instructions[instructionKey(mode)] ?? saved?.instruction ?? saved?.reenact?.basePrompt ?? defaultInstructions[mode];
  };
  const changeInstruction = (mode: Mode, value: string) => {
    const key = subjectKey(mode), version = modeJob(mode)?.id || "new";
    setVersions(items => ({ ...items, [key]: version }));
    setInstructions(items => ({ ...items, [`${key}:${version}`]: value }));
  };
  const multiJob = modeJob("multi-reenact");
  const multiKey = `${subjectKey("multi-reenact")}:${multiJob?.id || "new"}`;
  const multiReference = multiJob && references[multiJob.id];
  const multiSubjects = multiSubjectDrafts[multiKey] ?? multiReference?.generationSubjects ?? multiReference?.reenact?.subjects ?? [];
  const multiPrompt = taskInstruction("multi-reenact");
  const savedMulti = multiReference?.reenact?.subjects || [];
  const multiStale = !!multiJob?.result && (multiSubjects.length !== savedMulti.length || multiSubjects.some((item, index) => {
    const saved = savedMulti[index];
    return !saved || item.id !== saved.id || item.subjectImage !== saved.subjectImage || item.role !== saved.role || item.detail !== saved.detail;
  }) || multiPrompt.trim() !== (multiJob.instruction ?? multiJob.reenact?.basePrompt)?.trim());
  const job = modeJob(preferences.mode);
  const activeJob = job;
  const running = job?.status === "running";
  const loadingProject = !!selection && !activeProject;
  const result = job?.result;
  const promptLoading = !!activeProject && !result && running;
  const cancelling = !!job && cancellingJobs.includes(job.id);
  const promptDraft = job && promptDrafts[job.id];
  const reading = selection && !selection.image && !selection.error;
  const referenceError = job && referenceErrors[job.id];
  const restoring = !!job?.reenact && !references[job.id] && !referenceError;
  const blocked = !connected || !selectedModel || busy || savingMode || modelBusy || cliBusy || !!running || loadingProject || restoring;

  useEffect(() => {
    setCopied(false);
    return () => clearTimeout(copyTimer.current);
  }, [job?.id, lang, promptDraft]);

  useEffect(() => {
    let cancelled = false;
    let stopPolling = () => {};
    let previous: Selection | undefined;
    let initialized = false;
    const refresh = async () => {
      try {
        const revision = modeRevision.current;
        const visibility = visibilityRevision.current;
        const snapshotRevision = selectionRevision.current;
        const value = await readState(previous?.image ? previous.id : undefined, previous?.jobId);
        if (cancelled) return 1500;
        setPreferences((previous) => ({ ...value.preferences,
          mode: revision === modeRevision.current && revision % 2 === 0 ? value.preferences.mode : previous.mode,
          showHiddenProjects: visibility === visibilityRevision.current ? value.preferences.showHiddenProjects : previous.showHiddenProjects,
        }));
        const firstRefresh = !initialized;
        if (firstRefresh) setSettings(!value.preferences.paired);
        initialized = true;
        if (!deletingProjects.current && !value.selection && snapshotRevision === selectionRevision.current) {
          previous = undefined;
          setSelection(undefined);
          setProject(undefined);
        } else if (!deletingProjects.current && value.selection && snapshotRevision === selectionRevision.current) {
          const next = { ...value.selection,
            image: value.selection.image || (previous?.id === value.selection.id ? previous.image : undefined),
          };
          if (previous?.id !== next.id) { if (!firstRefresh) setHistoryOpen(false); setError(""); }
          previous = next;
          setSelection(next);
        }
      } catch (e) { if (!cancelled) setError((e as Error).message); }
      return 1500;
    };
    const initialize = async () => {
      const id = workspace && new URLSearchParams(location.search).get("handoff");
      if (id) {
        try {
          const handoff = await request<{ selection?: Selection; draft?: { multiSubjectDrafts?: Record<string, MultiSubject[]>; subjectDrafts?: Record<string, string>; promptDrafts?: Record<string, PromptDraft>; instructions?: Record<string, string>; versions?: Record<string, string>; lang?: "zh" | "en" } }>({ type: "alchemy:workspace-handoff", id });
          if (cancelled) return;
          if (handoff?.draft) {
            setSubjectDrafts(handoff.draft.subjectDrafts || {});
            setMultiSubjectDrafts(handoff.draft.multiSubjectDrafts || {});
            setPromptDrafts(handoff.draft.promptDrafts || {});
            setInstructions(handoff.draft.instructions || {});
            setVersions(handoff.draft.versions || {});
            setLang(handoff.draft.lang || "zh");
          }
          history.replaceState(null, "", location.pathname);
        } catch (e) { if (!cancelled) setError((e as Error).message); }
      }
      if (!cancelled) stopPolling = pollWhileVisible(refresh);
    };
    void initialize();
    return () => { cancelled = true; stopPolling(); };
  }, []);

  // Older extension selections join the same durable template project on first open.
  useEffect(() => {
    if (!preferences.paired || !selection?.image || selection.projectId) return;
    let cancelled = false;
    void request<Selection>({ type: "alchemy:ensure-project", id: selection.id }).then(
      (next) => { if (!cancelled) { selectionRevision.current++; setSelection(next); } },
      (e) => { if (!cancelled) setError(e.message); },
    );
    return () => { cancelled = true; };
  }, [preferences.paired, selection?.id, !!selection?.image, selection?.projectId]);

  useEffect(() => {
    if (!preferences.paired) return;
    let cancelled = false;
    let fetchedRevision: string | undefined;
    const stop = pollWhileVisible(async () => {
      const revision = projectRevision.current;
      let delay = 10_000;
      try {
        const health = await query<{ ready: boolean; skill: string; active: number; visibleActive?: number; hiddenProjectIds?: string[]; projectsRevision?: string; modelBusy?: boolean; cliBusy?: boolean; model?: string }>("/health");
        if (cancelled) return delay;
        setConnected(health.ready);
        setServiceBusy(health.active > 0);
        if (revision === projectRevision.current) {
          setActiveCount(health.visibleActive ?? health.active);
          setHiddenProjectIds(health.hiddenProjectIds || []);
        }
        setCliBusy(!!health.cliBusy);
        setModelBusy(!!health.modelBusy);
        setSelectedModel(health.model || null);
        setConnectionText(health.ready ? `已连接 · ${health.skill}` : "未找到图片逆向技能");
        delay = health.active || health.modelBusy || health.cliBusy ? 2000 : 10_000;
        // An older bridge must report an upgrade need instead of silently showing an empty library.
        const nextRevision = health.projectsRevision || "legacy";
        if (!deletingProjects.current) setDataRevision(nextRevision);
        if (selection?.projectId && !deletingProjects.current && (nextRevision !== fetchedRevision || nextRevision === "legacy")) {
          const saved = projectSnapshot.current;
          const value = await request<Project | { unchanged: true; revision: string }>({ type: "alchemy:project", id: selection.projectId,
            revision: saved?.id === selection.projectId ? saved.revision : undefined });
          if (!cancelled && revision === projectRevision.current) {
            if (!("unchanged" in value)) setProject(value);
            fetchedRevision = nextRevision;
          }
        }
      } catch (e) {
        if (!cancelled && revision === projectRevision.current) { setConnected(false); setConnectionText((e as Error).message); }
      }
      return delay;
    });
    return () => { cancelled = true; stop(); };
  }, [preferences.paired, selection?.projectId, refreshNonce, showHidden]);

  useEffect(() => {
    if (!job?.reenact || references[job.id] || referenceErrors[job.id]) return;
    let cancelled = false;
    void request<Selection>({ type: "alchemy:reference", id: job.id }).then(
      (value) => { if (!cancelled) setReferences((items) => ({ ...items, [job.id]: value })); },
      (e) => { if (!cancelled) setReferenceErrors((items) => ({ ...items, [job.id]: e.message })); },
    );
    return () => { cancelled = true; };
  }, [job?.id, !!job?.reenact, referenceError]);

  const openWorkspace = async () => {
    try {
      const prefix = `${selection?.projectId || selection?.id}:`;
      const forProject = <T,>(items: Record<string, T>) => Object.fromEntries(Object.entries(items).filter(([key]) => key.startsWith(prefix)));
      await request({ type: "alchemy:open-workspace", draft: {
        multiSubjectDrafts: forProject(multiSubjectDrafts), subjectDrafts: forProject(subjectDrafts), instructions: forProject(instructions), versions: forProject(versions), lang,
        promptDrafts: Object.fromEntries(Object.entries(promptDrafts).filter(([id]) => activeProject?.jobs.some(job => job.id === id))),
      } });
    } catch (e) { setError((e as Error).message); }
  };
  const uploadReference = async (file?: File, keepComposition = false) => {
    if (!file) return;
    setBusy(true); setError("");
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024)
        throw new Error("请上传不超过 20 MB 的 PNG、JPEG 或 WebP 图片");
      const image = await normalizeImage(file, 4 * 1024 * 1024);
      const next = await request<Selection>({ type: "alchemy:upload-reference", image });
      if (keepComposition && next.projectId) {
        const target = await request<Project>({ type: "alchemy:project", id: next.projectId });
        const version = versions[`${next.projectId}:multi-reenact`];
        const targetJob = version === "new" ? undefined : target.jobs.find(item => item.id === version && item.mode === "multi-reenact") || target.jobs.find(item => item.mode === "multi-reenact");
        const key = `${next.projectId}:multi-reenact:${targetJob?.id || "new"}`;
        setMultiSubjectDrafts(items => ({ ...items, [key]: multiSubjects }));
        setInstructions(items => ({ ...items, [key]: multiPrompt }));
      }
      selectionRevision.current++;
      setSelection(next); setHistoryOpen(false); setNewProjectOpen(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const applyReferenceRotation = async (image: string, mode: Mode, instruction?: string) => {
    if (blocked || !selection?.image) throw new Error("当前无法修改图片，请稍后重试");
    const revision = selectionRevision.current;
    setBusy(true);
    try {
      const next = await request<Selection>({ type: "alchemy:upload-reference", image });
      if (revision !== selectionRevision.current) throw new Error("当前图片已切换，请重新打开预览");
      const key = `${next.projectId}:${mode}`;
      setVersions(items => ({ ...items, [key]: "new" }));
      if (mode === "multi-reenact") setMultiSubjectDrafts(items => ({ ...items, [`${key}:new`]: multiSubjects }));
      else if (mode !== "recreate") setSubjectDrafts(items => ({ ...items, [key]: subjectImage(mode) }));
      if (instruction !== undefined) setInstructions(items => ({ ...items, [`${key}:new`]: instruction }));
      selectionRevision.current++;
      setSelection(next); setError(""); setHistoryOpen(false);
    } finally { setBusy(false); }
  };
  const swapImages = async (mode: "style" | "reenact" | "multi-reenact", instruction: string, subjectId?: string) => {
    const image = mode === "multi-reenact" ? multiSubjects.find(item => item.id === subjectId)?.subjectImage : subjectImage(mode);
    if (blocked || !selection?.image || !image) return;
    setBusy(true); setError("");
    try {
      const blob = await (await fetch(selection.image)).blob();
      const subject = blob.size <= 2 * 1024 * 1024 ? selection.image : await normalizeImage(blob, 2 * 1024 * 1024);
      const next = await request<Selection>({ type: "alchemy:upload-reference", image });
      const key = `${next.projectId}:${mode}`;
      setVersions(items => ({ ...items, [key]: "new" }));
      if (mode === "multi-reenact") {
        setMultiSubjectDrafts(items => ({ ...items, [`${key}:new`]: multiSubjects.map(item => item.id === subjectId
          ? { ...item, subjectImage: subject, role: "自动", detail: "" } : item) }));
        setSwappedSubjectId(subjectId!);
      } else setSubjectDrafts(items => ({ ...items, [key]: subject }));
      setInstructions(items => ({ ...items, [`${key}:new`]: instruction }));
      selectionRevision.current++;
      setSelection(next); setHistoryOpen(false);
    } catch (e) { setError((e as Error).message || "无法互换图片，请重试"); }
    finally { setBusy(false); }
  };
  const updateJob = (updated: Job) => {
    projectRevision.current++;
    setRefreshNonce(value => value + 1);
    setProject((current) => current && current.id === updated.projectId
      ? { ...current, jobs: [updated, ...current.jobs.filter((item) => item.id !== updated.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
      : current);
  };
  const saveMode = async (mode: Mode) => {
    if (savingMode || busy) return;
    const previous = preferences.mode;
    setCopied(false);
    setError("");
    modeRevision.current++;
    setSavingMode(true);
    setPreferences((value) => ({ ...value, mode }));
    try {
      await request({ type: "alchemy:mode", mode });
    } catch (e) {
      setPreferences((value) => ({ ...value, mode: previous }));
      setError((e as Error).message);
    } finally {
      modeRevision.current++;
      setSavingMode(false);
    }
  };
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const health = await request<{ ready: boolean; skill: string }>({ type: "alchemy:connect", token: tokenDraft.trim() });
      setPreferences({ ...preferences, paired: true });
      setTokenDraft("");
      setConnected(true);
      setConnectionText(`已连接 · ${health.skill}`);
      setSettings(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const start = async (mode: Mode = preferences.mode, reenact?: SubjectInput) => {
    if (!selection?.image || !activeProject || blocked) return;
    setBusy(true);
    setError("");
    try {
      const value = await request<{ selection: Selection; job: Job }>({
        type: "alchemy:start", id: selection.id, projectId: activeProject.id, mode, reenact, instruction: taskInstruction(mode),
      });
      selectionRevision.current++;
      setSelection((current) => current?.id === selection.id ? value.selection : current);
      setReferences(items => ({ ...items, [value.job.id]: value.selection }));
      updateJob(value.job);
      setVersions((items) => ({ ...items, [`${activeProject.id}:${mode}`]: value.job.id }));
      setCopied(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const showHistory = () => {
    setHistoryOpen(value => !value);
    setError("");
  };
  const openProject = async (item: ProjectSummary) => {
    setBusy(true);
    setError("");
    try {
      const next = await request<Selection>({ type: "alchemy:open-project", id: item.id });
      selectionRevision.current++;
      setSelection(next);
      setHistoryOpen(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const deleteProjects = async (ids: string[]) => {
    setBusy(true);
    setError("");
    selectionRevision.current++;
    projectRevision.current++;
    deletingProjects.current = true;
    try {
      const { deletedIds } = await request<{ deletedIds: string[] }>({ type: "alchemy:delete-projects", ids });
      const removedJobs = activeProject && deletedIds.includes(activeProject.id) ? activeProject.jobs.map((job) => job.id) : [];
      library.refresh();
      setRefreshNonce(value => value + 1);
      if (selection?.projectId && deletedIds.includes(selection.projectId)) { setSelection(undefined); setProject(undefined); }
      setVersions((items) => Object.fromEntries(Object.entries(items).filter(([key]) => !deletedIds.some((id) => key.startsWith(`${id}:`)))));
      setPromptDrafts((items) => Object.fromEntries(Object.entries(items).filter(([id]) => !removedJobs.includes(id))));
      setMultiSubjectDrafts((items) => Object.fromEntries(Object.entries(items).filter(([key]) => !deletedIds.some((id) => key.startsWith(`${id}:`)))));
      setSubjectDrafts((items) => Object.fromEntries(Object.entries(items).filter(([key]) => !deletedIds.some((id) => key.startsWith(`${id}:`)))));
      setReferences((items) => Object.fromEntries(Object.entries(items).filter(([id, value]) => !removedJobs.includes(id) && !deletedIds.includes(value.projectId || ""))));
      setReferenceErrors((items) => Object.fromEntries(Object.entries(items).filter(([id]) => !removedJobs.includes(id))));
    } finally { deletingProjects.current = false; selectionRevision.current++; projectRevision.current++; setBusy(false); }
  };
  const setProjectsHidden = async (ids: string[], hidden: boolean) => {
    setBusy(true);
    selectionRevision.current++;
    projectRevision.current++;
    deletingProjects.current = true;
    try {
      const { updatedIds } = await request<{ updatedIds: string[] }>({ type: "alchemy:set-project-hidden", ids, hidden });
      setHiddenProjectIds(previous => hidden ? [...new Set([...previous, ...updatedIds])] : previous.filter(id => !updatedIds.includes(id)));
      if (project && updatedIds.includes(project.id)) setProject({ ...project, hidden });
      if (hidden && !showHidden && selection?.projectId && updatedIds.includes(selection.projectId)) { setSelection(undefined); setProject(undefined); }
      library.refresh();
      setRefreshNonce(value => value + 1);
    } finally { deletingProjects.current = false; selectionRevision.current++; projectRevision.current++; setBusy(false); }
  };
  const toggleHiddenProjects = async () => {
    setBusy(true); setError("");
    visibilityRevision.current++;
    projectRevision.current++;
    try {
      const shown = await request<boolean>({ type: "alchemy:show-hidden-projects", show: !showHidden });
      visibilityRevision.current++;
      setPreferences(previous => ({ ...previous, showHiddenProjects: shown }));
      if (!shown && (project?.hidden || (selection?.projectId && hiddenProjectIds.includes(selection.projectId)))) {
        selectionRevision.current++; setSelection(undefined); setProject(undefined); setHistoryOpen(true);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!job || !running || pendingCancellations.current.has(job.id)) return;
    pendingCancellations.current.add(job.id);
    setCancellingJobs([...pendingCancellations.current]);
    setError("");
    try { updateJob(await request<Job>({ type: "alchemy:cancel", id: job.id })); }
    catch (e) { setError((e as Error).message); }
    finally {
      pendingCancellations.current.delete(job.id);
      setCancellingJobs([...pendingCancellations.current]);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        lang === "zh" ? (promptDraft || result)!.promptZh : (promptDraft || result)!.promptEn,
      );
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("复制失败，请选中提示词手动复制");
    }
  };
  const discardPrompt = (id: string) => setPromptDrafts((items) => {
    const next = { ...items };
    delete next[id];
    return next;
  });
  const savePrompt = async () => {
    if (!job || !promptDraft || savingPrompt) return;
    setSavingPrompt(job.id);
    setError("");
    try {
      updateJob(await request<Job>({ type: "alchemy:save-prompt", id: job.id, ...promptDraft }));
      discardPrompt(job.id);
    } catch (e) { setError((e as Error).message); }
    finally { setSavingPrompt(""); }
  };
  const exportResult = () => {
    if (!job?.result) return;
    const r = job.result;
    const inputs = job.mode === "multi-reenact" ? `\n使用方法：依次附图 1–${job.reenact?.subjects?.length || 0}（主体图），最后附参考模板，再使用下方提示词。此 Markdown 不包含图片文件。\n` : job.reenact ? "\n使用方法：生成图片时，先附图 1（用户主体图），再附图 2（原始参考图），然后使用下方提示词。此 Markdown 不包含图片文件。\n" : "";
    const markdown = `# ${r.title}\n\n来源：${job.sourceUrl || "网页图片"}\n模式：${modeName(job.mode)}\n${inputs}\n## 视觉观察\n${r.observations.map((x) => `- ${x}`).join("\n")}\n\n## 中文提示词\n${r.promptZh}\n\n## English prompt\n${r.promptEn}\n\n## 排除项\n${r.negativePrompt || "无"}\n\n## 不确定性\n${r.uncertainties.join("\n") || "无额外说明"}\n`;
    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `qc-reframe-${job.id.slice(0, 8)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const reverseStatus = reading ? selection?.stage || "正在读取图片…" : running ? job?.stage || "正在逆向提示词…"
    : restoring ? "正在恢复原图…" : loadingProject ? "正在读取模板项目…" : cliBusy ? "Codex 正在升级…"
    : modelBusy ? "正在验证模型…" : busy ? "正在提交…" : undefined;

  const newVersion = versions[`${activeProject?.id}:${preferences.mode}`] === "new";
  const versionSelector = modeJobs(preferences.mode).length > 0 && <SelectField className="version-select" label="" aria-label="提示词版本" value={job?.id || "new"} disabled={busy}
              onChange={(e) => { setCopied(false); setVersions((items) => ({ ...items, [`${activeProject!.id}:${preferences.mode}`]: e.target.value })); }}>
              {newVersion && <option value="new">待逆向</option>}
              {modeJobs(preferences.mode).map((item, i, items) => <option key={item.id} value={item.id}>{`版本 ${items.length - i}${i === 0 ? " · 最新" : ""}`}</option>)}
            </SelectField>;
  const multiPreview = preferences.mode === "multi-reenact" ? <MultiInputPreview image={selection?.image} subjects={multiSubjects} /> : undefined;
  const drawerKey = `${selection?.projectId || selection?.id}:${preferences.mode}:${activeJob?.id || "new"}`;
  const drawer = resultDrawerView(drawers, drawerKey, activeJob?.generations);
  const drawerOpen = workspace && !historyOpen && drawer.open;
  const closeResults = () => {
    dispatchDrawer({ type: "toggle", key: drawerKey, open: false, seen: drawer.completed });
    requestAnimationFrame(() => resultReturn.current?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    const media = matchMedia("(max-width: 650px)");
    const sidebarMedia = matchMedia("(max-width: 860px)");
    const update = () => { setNarrow(media.matches); setSmallSidebar(sidebarMedia.matches); };
    media.addEventListener("change", update);
    sidebarMedia.addEventListener("change", update);
    return () => { media.removeEventListener("change", update); sidebarMedia.removeEventListener("change", update); };
  }, []);
  useEffect(() => {
    const closed = wasDrawerOpen.current && !drawerOpen;
    wasDrawerOpen.current = drawerOpen;
    if (!workspace || !closed || !(resultPane?.contains(document.activeElement) || document.activeElement === document.body)) return;
    (resultReturn.current || editor.current?.querySelector<HTMLButtonElement>(".generate-button"))?.focus({ preventScroll: true });
  }, [workspace, drawerOpen, resultPane]);
  useEffect(() => {
    if (!workspace || !narrow || !drawerOpen) return;
    if (editor.current?.contains(document.activeElement) || document.activeElement === document.body) resultPane?.querySelector<HTMLButtonElement>(".result-collapse")?.focus({ preventScroll: true });
  }, [workspace, narrow, drawerOpen, resultPane]);
  const generationPanel = activeJob?.result ? <GenerationPanel key={activeJob.id} job={activeJob} lang={lang} workspace={workspace}
                  drawerOpen={drawerOpen} onCollapse={closeResults} requestError={drawer.error} requestPending={drawer.pending}
                  onRequestState={(pending, error) => dispatchDrawer({ type: pending ? "request" : "settled", key: drawerKey, error })} versionNumber={modeJobs(preferences.mode).length - modeJobs(preferences.mode).findIndex(item => item.id === activeJob.id)} actionsTarget={generationActions} disabled={!connected || !selectedModel || busy || modelBusy || cliBusy || !!running || !!promptDraft || (activeJob.mode === "multi-reenact" && multiStale)}
                  subjectImage={activeJob.mode === "recreate" ? undefined : subjectImage(activeJob.mode)}
                  inputPreview={multiPreview}
                  subjects={activeJob.mode === "multi-reenact" ? multiSubjects : undefined}
                  onUpdate={(updated, image, subjects) => {
                    if (subjects) setReferences(items => items[updated.id] ? { ...items, [updated.id]: { ...items[updated.id]!, generationSubjects: subjects } } : items);
                    updateJob(updated);
                    if (image) setReferences((items) => {
                      const saved = items[updated.id];
                      return saved ? { ...items, [updated.id]: { ...saved, generationSubjectImage: image } } : items;
                    });
                  }} /> : null;

  return (
    <div className={`${workspace ? "app workspace-app" : "app"}${preferences.mode === "multi-reenact" ? " multi-mode" : ""}`} data-motion={reduced ? "reduce" : "full"} data-motion-input="keyboard" data-sidebar-collapsed={sidebarCollapsed}
      onPointerDownCapture={event => { event.currentTarget.dataset.motionInput = "pointer"; }}
      onKeyDownCapture={event => { event.currentTarget.dataset.motionInput = "keyboard"; }}
      onClickCapture={event => { if (!event.detail) event.currentTarget.dataset.motionInput = "keyboard"; }}
      onKeyDown={event => {
        if (event.key === "Escape" && drawerOpen && !event.defaultPrevented && !(event.target as Element).closest("dialog")) { event.stopPropagation(); closeResults(); }
      }}>
      {workspace && <aside id="workspace-sidebar" className="sidebar" aria-label="工作台导航">
        <div className="logo-row"><img src={logo} alt="QC-Reframe" /><div><strong>QC-Reframe</strong></div><button className="quiet-button sidebar-toggle" aria-label={sidebarCollapsed ? "展开项目栏" : "收起项目栏"} title={sidebarCollapsed ? "展开项目栏" : "收起项目栏"} aria-expanded={!sidebarCollapsed} aria-controls="workspace-sidebar" onClick={() => setSidebarExpanded(sidebarCollapsed)}><Icon name="sidebar" /></button></div>
        <button className="new-project" aria-label="新建项目" disabled={busy || !connected} onClick={() => { setError(""); setNewProjectOpen(true); }}><Icon name="plus" /><span>新建项目</span></button>
        <input ref={referenceInput} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传参考图新建项目" onChange={(e) => { void uploadReference(e.target.files?.[0]); e.target.value = ""; }} />
        <button className={`nav-action ${historyOpen ? "active" : ""}`} aria-label="全部项目" disabled={busy || !connected} onClick={showHistory}><Icon name="grid" /><span>全部项目</span><span className="count">{library.recent.total}</span></button>
        <button className="nav-action" aria-label="任务中心" disabled={!connected} onClick={() => setTasksOpen(true)}><Icon name="clock" /><span>任务中心</span>{activeCount > 0 && <span className="count">{activeCount}</span>}</button>
        <div className="sidebar-label">最近项目</div>
        <div className="project-nav">{recentProjects.map(item => <RecentProject key={item.id} project={item} currentMode={preferences.mode} active={!historyOpen && activeProject?.id === item.id} disabled={busy} onOpen={() => void openProject(item)} />)}</div>
        <div className="sidebar-bottom"><button className="nav-action" aria-label="设置中心" onClick={() => setSettings(true)}><Icon name="settings" /><span>设置中心</span></button><div className="connection-state"><i className={`online-dot ${connected ? "" : "offline"}`} />{connected ? "Codex 已连接" : "本机未连接"}</div></div>
      </aside>}
      <div className={workspace ? "workspace-main" : "compact-main"}>
      {workspace && <header className="workspace-head"><div><h1>{historyOpen ? "全部项目" : activeProject?.title || "新项目"}</h1></div><div className="head-actions">
        {historyOpen && <div ref={setProjectSearchTarget} />}
        {!historyOpen && drawer.content && !drawerOpen && <button ref={resultReturn} className="outline-button result-return" aria-controls="workspace-results" aria-expanded={false} onClick={() => dispatchDrawer({ type: "toggle", key: drawerKey, open: true, seen: drawer.completed })}><Icon name="image" />{drawer.label}</button>}
        {!historyOpen && <><span className="badge"><i className="online-dot" />{selectedModel || "未选择模型"}</span><button className="quiet-button" aria-label="导出提示词" disabled={!result || !!promptDraft} onClick={exportResult}><Icon name="download" /><span>导出提示词</span></button></>}
        <HiddenProjectsToggle shown={showHidden} disabled={busy || !connected} onToggle={() => void toggleHiddenProjects()} />
        <button className="outline-button" disabled={!connected} onClick={() => setTasksOpen(true)}><Icon name="clock" />{activeCount ? `${activeCount} 项执行中` : "任务中心"}</button>
      </div></header>}
      {!workspace && !embedded && <header>
        <div className="brand">
          <img className="brand-mark" src={logo} alt="" />
          <strong>QC-Reframe</strong>
        </div>
      </header>}
      {!workspace && <div className="connection">
        <span className={`dot ${connected ? "online" : ""}`} />
        <span title={connectionText}>
          {connected ? "Codex 已连接" : "Codex 未连接"}
        </span>
        <button className="text-button" disabled={busy} onClick={showHistory} aria-expanded={historyOpen}>
          <Icon name={historyOpen ? "back" : "history"} />
          {historyOpen ? "返回项目" : "项目记录"}
        </button>
        <HiddenProjectsToggle shown={showHidden} disabled={busy || !connected} onToggle={() => void toggleHiddenProjects()} />
        <button className="text-button workspace-entry" onClick={openWorkspace} title="在新标签页打开宽版工作台"><Icon name="expand" />工作台</button>
        <button
          className="icon-button"
          title="连接设置"
          aria-label="连接设置"
          aria-expanded={settings}
          onClick={() => {
            setSettings(!settings);
            setError("");
          }}
        >
          <Icon name="settings" />
        </button>
      </div>}

      {!workspace && settings && (
        <section className="settings card">
          <h2>连接 Codex</h2>
          <details className="inline-help" open={!connected}><summary>如何获取配对码？</summary><p>在插件目录打开终端，启动服务并获取配对码。</p><code className="command">npm start<br />npm run pair</code></details>
          <label htmlFor="pair-token">本机配对码</label>
          <input
            id="pair-token"
            type="password"
            autoComplete="off"
            value={tokenDraft}
            placeholder="粘贴终端中的配对码"
            onChange={(e) => setTokenDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void connect();
            }}
          />
          <button
            className="primary"
            disabled={busy || !tokenDraft.trim()}
            onClick={connect}
          >
            {busy ? "正在连接…" : "连接 Codex"}
          </button>
          {connected && <ModelSettings serviceBusy={serviceBusy} />}
        </section>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {!connected && preferences.paired && !settings && (
        <div className="error">{connectionText}</div>
      )}
      {connected && !selectedModel && !settings && <div className="model-notice">
        <span>先为 QC-Reframe 选择可用模型</span>
        <button className="text-button" onClick={() => setSettings(true)}>选择模型</button>
      </div>}

      {workspace && newProjectOpen && <NewProject busy={busy} error={error} onClose={() => setNewProjectOpen(false)} onUpload={() => referenceInput.current?.click()} />}
      {workspace && settings && <SettingsCenter connected={connected} serviceBusy={serviceBusy} onClose={() => setSettings(false)} onConnected={() => setPreferences(value => ({ ...value, paired: true }))} />}
      {workspace && tasksOpen && <TaskCenter showHidden={showHidden} hiddenProjectIds={hiddenProjectIds} busy={busy} onToggleHidden={() => void toggleHiddenProjects()} onClose={() => setTasksOpen(false)} onUpdate={updateJob} onOpen={async (projectId, mode, jobId) => {
        const next = await request<Selection>({ type: "alchemy:open-project", id: projectId });
        selectionRevision.current++; setSelection(next); setHistoryOpen(false);
        setVersions(items => ({ ...items, [`${projectId}:${mode}`]: jobId }));
        await saveMode(mode);
      }} />}
      <div className={workspace ? "workspace-body" : undefined} data-results-open={drawerOpen} data-history={historyOpen}>
      <div ref={editor} className={workspace ? "workspace-editor" : undefined} inert={workspace && narrow && drawerOpen}>
      <main>
        {historyOpen ? (
          <ProjectHistory searchTarget={projectSearchTarget} workspace={workspace} projects={library.data.items.filter(visibleProject)} page={library.page} total={library.data.total} pageSize={library.data.pageSize} search={library.search} status={library.status} onStatus={library.setStatus} loading={library.loading} loadError={library.error} onPage={library.setPage} onSearch={library.setSearch} onRetry={library.refresh} busy={busy} onOpen={openProject} onDelete={deleteProjects} showHidden={showHidden} onSetHidden={setProjectsHidden} />
        ) : (
          <>
            {!selection && (
              <section className="empty">
                <span className="empty-mark"><Icon name="image" /></span>
                <h1>选择一张参考图</h1>
              </section>
            )}

            {!workspace && activeProject && <div className="project-heading"><h1>{activeProject.title}</h1></div>}
            {referenceError && <div className="error" role="alert">{referenceError}
              <button className="text-button" disabled={!connected} onClick={() => setReferenceErrors((items) => {
                const next = { ...items }; delete next[job!.id]; return next;
              })}>重新读取主体图</button>
            </div>}
            <div className="mode-switch" role="group" aria-label="项目逆向路径">
              <button
                className={preferences.mode === "style" ? "active" : ""}
                aria-pressed={preferences.mode === "style"}
                disabled={savingMode || busy}
                onClick={() => saveMode("style")}
              >
                提取风格{activeProject && modeJob("style") && <small>{laneStatus(modeJob("style"))}</small>}
              </button>
              <button
                className={preferences.mode === "recreate" ? "active" : ""}
                aria-pressed={preferences.mode === "recreate"}
                disabled={savingMode || busy}
                onClick={() => saveMode("recreate")}
              >
                完整复刻{activeProject && modeJob("recreate") && <small>{laneStatus(modeJob("recreate"))}</small>}
              </button>
              <button className={preferences.mode === "reenact" ? "active" : ""}
                aria-pressed={preferences.mode === "reenact"} disabled={savingMode || busy}
                onClick={() => saveMode("reenact")}>
                主体重演{activeProject && modeJob("reenact") && <small>{laneStatus(modeJob("reenact"))}</small>}
              </button>
              <button className={preferences.mode === "multi-reenact" ? "active" : ""} aria-pressed={preferences.mode === "multi-reenact"} disabled={savingMode || busy} onClick={() => saveMode("multi-reenact")}>
                多图重演{activeProject && modeJob("multi-reenact") && <small>{laneStatus(modeJob("multi-reenact"))}</small>}
              </button>
            </div>
            {selection && <div className="step-title"><h2><span className="step-index">1</span>{preferences.mode === "multi-reenact" ? "组合画面" : "准备画面"}</h2>{preferences.mode === "multi-reenact" && <span className="multi-subject-count">{multiSubjects.length} 张主体图</span>}</div>}
            {selection && preferences.mode === "recreate" && (
              <div className="workspace-inputs single"><ImageInput error={selection.error} image={selection.image} rotation={{ disabled: blocked, onApply: image => applyReferenceRotation(image, "recreate", taskInstruction("recreate")) }} label="风格参考图" alt="本次选择的参考图片" /></div>
            )}
            {(selection || result) && (
              <>
                {(selection?.error || job?.error) && (
                  <div className="error" role="alert">
                    {job?.error || selection?.error}
                  </div>
                )}
                {selection && preferences.mode === "recreate" && (<>
                  <TaskInstruction value={taskInstruction("recreate")} disabled={blocked} onChange={value => changeInstruction("recreate", value)} />
                  {!promptLoading && <AsyncAction className={workspace ? "workspace-reverse" : ""} status={reverseStatus} onCancel={running ? cancel : undefined} cancelling={cancelling}>
                  <button
                    className={workspace ? "outline-button" : "primary"}
                    disabled={blocked || !selection.image}
                    onClick={() => start()}
                    aria-busy={busy || running}
                  >
                    {workspace && !busy && !running && <Icon name="edit" />}
                    {busy
                      ? "正在提交…"
                      : restoring
                        ? "正在恢复原图…"
                        : running
                          ? `正在${modeName(preferences.mode)}…`
                          : workspace ? result ? "重新逆向提示词" : "逆向提示词" : "生成复刻提示词"}
                  </button>
                  </AsyncAction>}
                </>)}
              </>
            )}

            {selection && (["style", "reenact"] as const).map((mode) => {
              const savedJob = modeJob(mode);
              const savedReference = savedJob && references[savedJob.id];
              return <SubjectForm workspace={workspace} key={`${selection.projectId || selection.id}-${mode}-${savedJob?.id || "new"}`} mode={mode}
                selection={{ ...selection, reenact: savedReference?.reenact, subjectError: savedReference?.subjectError }} job={savedJob}
                instruction={taskInstruction(mode)} onInstructionChange={value => changeInstruction(mode, value)}
                subjectImage={subjectImage(mode)} onSubjectChange={(image) => setSubjectDrafts((items) => ({ ...items, [subjectKey(mode)]: image }))}
                active={preferences.mode === mode} disabled={blocked || !selection.image}
                status={preferences.mode === mode ? reverseStatus : undefined} onCancel={running ? cancel : undefined}
                hideAction={promptLoading && preferences.mode === mode} cancelling={cancelling}
                submitting={busy} onSubmit={(input) => start(mode, input)}
                onReferenceRotate={(image, instruction) => applyReferenceRotation(image, mode, instruction)}
                onSwap={instruction => void swapImages(mode, instruction)}
                onExtract={mode === "style" ? () => start("style") : undefined} />;
            })}
            {selection && <MultiSubjectForm key={multiKey} image={selection.image} imageError={selection.error} subjects={multiSubjects} instruction={multiPrompt} initialSelectedId={swappedSubjectId}
              active={preferences.mode === "multi-reenact"} disabled={blocked || !selection.image} status={preferences.mode === "multi-reenact" ? reverseStatus : undefined}
              hasPrompt={!!multiJob?.result} stale={multiStale} onCancel={running ? cancel : undefined}
              hideAction={promptLoading && preferences.mode === "multi-reenact"} cancelling={cancelling}
              onChange={subjects => setMultiSubjectDrafts(items => ({ ...items, [multiKey]: subjects }))}
              onInstruction={value => changeInstruction("multi-reenact", value)}
              onReferenceRotate={image => applyReferenceRotation(image, "multi-reenact", multiPrompt)}
              onSubmit={input => start("multi-reenact", input)} onReference={file => void uploadReference(file, true)} onSwap={id => void swapImages("multi-reenact", multiPrompt, id)} />}
            {activeProject && !result && <section className="lane-empty" aria-label={`${modeName(preferences.mode)}待生成`}>
              <div className="step-title"><h2><span className="step-index">2</span>雕琢提示词</h2>{versionSelector}</div><LoadingPlaceholder className="empty-prompt" active={!!running}
                action={promptLoading && <button type="button" className="quiet-button" disabled={cancelling} onClick={cancel}>{cancelling ? "正在取消…" : "取消"}</button>}>
                {running ? job.stage || "正在逆向提示词…" : job?.status === "failed" ? "逆向失败，请重试。" : job?.status === "cancelled" ? "任务已取消，可重新开始。" : "提示词待生成"}
              </LoadingPlaceholder>
            </section>}

            {result && activeJob && (
              <section className="result" aria-label={`${modeName(activeJob.mode)}提示词`}>
                <PromptEditor result={result} draft={promptDraft} lang={lang} copied={copied} saving={!!savingPrompt} disabled={!connected} versionSelector={versionSelector}
                  onLanguage={setLang} onCopy={copy} onEdit={() => setPromptDrafts(items => ({ ...items, [activeJob.id]: { promptZh: result.promptZh, promptEn: result.promptEn, negativePrompt: result.negativePrompt } }))}
                  onDraft={draft => setPromptDrafts(items => ({ ...items, [activeJob.id]: draft }))} onSave={savePrompt} onCancel={() => discardPrompt(activeJob.id)} />
                {!workspace && activeJob.mode === "style" && !activeJob.reenact && (
                  <InlineHelp label="风格提示词用法">把 [SUBJECT] 替换成你的创作主体。</InlineHelp>
                )}
                {!workspace && promptDraft && <p className="fine" role="status">请先保存或取消编辑，再生成图片或导出。</p>}
                {workspace ? resultPane && generationPanel && createPortal(generationPanel, resultPane) : generationPanel}
                <button className="secondary prompt-export" disabled={!!promptDraft} onClick={exportResult}>
                  <Icon name="download" />导出 Markdown
                </button>
              </section>
            )}
          </>
        )}
      </main>
      {workspace && !historyOpen && <div className="composer-footer" ref={setGenerationActions}>{!result && <button className="primary generate-button" disabled><Icon name="image" />生成图片<Icon name="arrow" /></button>}{promptDraft && <p className="hint">先保存或取消修改，再生成图片。</p>}</div>}
      </div>
      {workspace && !historyOpen && <div className="result-drawer-slot"><aside id="workspace-results" className="workspace-results" ref={setResultPane} aria-label="生成结果抽屉" aria-hidden={!drawerOpen} inert={!drawerOpen} /></div>}
      </div>
      </div>
    </div>
  );
}
