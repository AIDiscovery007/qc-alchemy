import { browser } from "wxt/browser";
import { bridge } from "../lib/bridge";
import { captureImage } from "../lib/capture";
import type {
  ImageTarget,
  Job,
  Mode,
  Preferences,
  SubjectInput,
  Selection,
} from "../lib/types";

export default defineBackground(() => {
  void browser.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const openResult = async (tabId: number) => {
    try {
      await browser.tabs.sendMessage(tabId, { type: "alchemy:show" });
    } catch {
      // Pages without a content script can show the result in an extension tab.
      await browser.tabs.create({
        url: `${browser.runtime.getURL("/popup.html")}?view=tab`,
      });
    }
  };
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.removeAll().then(() =>
      browser.contextMenus.create({
        id: "alchemy-image",
        title: "用 Alchemy 逆向图片风格",
        contexts: ["image"],
      }),
    );
  });
  let selecting = false;
  const select = async (
    target: ImageTarget,
    tab: { id: number; windowId: number; url?: string },
  ) => {
    if (selecting) throw new Error("正在读取上一张图片，请稍候");
    selecting = true;
    let selection: Selection = {
      id: crypto.randomUUID(),
      sourceUrl: tab.url || "",
      stage: "正在读取所选图片…",
    };
    try {
      const stored = (await browser.storage.local.get([
        "preferences",
        "selection",
      ])) as { preferences?: Preferences; selection?: Selection };
      const preferences = stored.preferences;
      if (stored.selection?.jobId && preferences?.token) {
        let previous;
        try {
          previous = await bridge<Job>(
            `/jobs/${stored.selection.jobId}`,
            preferences.token,
          );
        } catch (error) {
          selection = { ...stored.selection, error: (error as Error).message };
          return;
        }
        if (previous.status === "running") {
          selection = {
            ...stored.selection,
            error: "上一张图片仍在逆向，请先等待完成或取消。",
          };
          return;
        }
      }
      await browser.storage.local.set({ selection });
      await browser.tabs
        .sendMessage(tab.id, { type: "alchemy:hide" })
        .catch(() => {});
      Object.assign(
        selection,
        await captureImage(target, tab.id, tab.windowId),
      );
      if (!preferences?.token) {
        selection.stage = "图片已就绪，请先连接本机 Codex";
      } else if (preferences.mode !== "recreate") {
        selection.stage = "参考图已就绪，请补充主体图；任务指令已默认填好";
      } else {
        const job = await bridge<Job>("/jobs", preferences.token, {
          image: selection.image,
          mode: preferences.mode || "style",
          sourceUrl: selection.sourceUrl,
          capture: selection.capture,
        });
        selection.jobId = job.id;
        selection.stage = job.stage;
      }
    } catch (error) {
      selection.error = error instanceof Error ? error.message : String(error);
    } finally {
      selecting = false;
      await browser.storage.local.set({ selection });
      // Open after capture so the floating UI cannot cover the selected image.
      await openResult(tab.id);
    }
  };
  const reference = async (id: string, token: string) => {
    if (typeof id !== "string" || !/^[\da-f-]{36}$/.test(id)) throw new Error("无效任务");
    try {
      return await bridge<Selection>(`/jobs/${id}/reference`, token);
    } catch (error) {
      if ((error as Error).message === "Not found")
        throw new Error("请重启本机服务 npm run bridge，以支持历史图片重新逆向。");
      throw error;
    }
  };
  const start = async (id: string, mode: Mode, referenceJobId?: string, reenact?: SubjectInput) => {
    if (selecting) throw new Error("正在处理图片，请稍候");
    selecting = true;
    try {
      const stored = (await browser.storage.local.get([
        "preferences",
        "selection",
      ])) as { preferences?: Preferences; selection?: Selection };
      if (!["style", "recreate", "reenact"].includes(mode)) throw new Error("无效模式");
      if ((mode === "reenact" || (mode === "style" && reenact !== undefined)) && (typeof reenact?.subjectImage !== "string" || !reenact.subjectImage || typeof reenact.basePrompt !== "string" || !reenact.basePrompt.trim()))
        throw new Error("请上传主体图并填写任务指令");
      const selection = referenceJobId
        ? { ...await reference(referenceJobId, stored.preferences?.token || ""), id: crypto.randomUUID() }
        : stored.selection;
      if (!selection?.image || (!referenceJobId && selection.id !== id))
        throw new Error("所选图片已变化，请重试");
      const job = await bridge<Job>("/jobs", stored.preferences?.token || "", {
        image: selection.image,
        mode,
        sourceUrl: selection.sourceUrl,
        capture: selection.capture,
        reenact: mode !== "recreate" ? reenact : undefined,
      });
      const next = { ...selection, jobId: job.id, stage: job.stage, error: undefined,
        reenact: mode !== "recreate" ? reenact : undefined, subjectError: undefined };
      await browser.storage.local.set({ selection: next });
      return { selection: next, job };
    } finally {
      selecting = false;
    }
  };
  const uiMessage = async (message: Record<string, any>) => {
    const { preferences, selection } = (await browser.storage.local.get([
      "preferences", "selection",
    ])) as { preferences?: Preferences; selection?: Selection };
    const token = preferences?.token || "";
    switch (message.type) {
      case "alchemy:state":
        return {
          preferences: { paired: !!token, mode: preferences?.mode || "style" },
          // The panel already holds this image; avoid resending megabytes each poll.
          selection: selection && selection.id === message.selectionId && selection.jobId === message.selectionJobId
            ? { ...selection, image: undefined, reenact: undefined } : selection,
        };
      case "alchemy:connect": {
        if (typeof message.token !== "string") throw new Error("无效配对码");
        const health = await bridge<{ ready: boolean; skill: string }>("/health", message.token);
        if (!health.ready) throw new Error("服务已启动，但未找到 Alchemy 技能。");
        await browser.storage.local.set({ preferences: { ...preferences, mode: preferences?.mode || "style", token: message.token } });
        return health;
      }
      case "alchemy:mode":
        if (!["style", "recreate", "reenact"].includes(message.mode)) throw new Error("无效模式");
        await browser.storage.local.set({ preferences: { ...preferences, token, mode: message.mode } });
        return;
      case "alchemy:query":
        if (typeof message.path !== "string" || !/^\/(health|jobs(?:\/[\w-]+)?)$/.test(message.path))
          throw new Error("无效请求");
        return bridge(message.path, token);
      case "alchemy:cancel":
        if (typeof message.id !== "string" || !/^[\w-]+$/.test(message.id)) throw new Error("无效任务");
        return bridge(`/jobs/${message.id}/cancel`, token, {});
      case "alchemy:reference":
        return reference(message.id, token);
      case "alchemy:generate":
      case "alchemy:generation-cancel":
      case "alchemy:generation-image": {
        if (typeof message.id !== "string" || !/^[\da-f-]{36}$/.test(message.id)) throw new Error("无效任务");
        const path = `/jobs/${message.id}/generations`;
        if (message.type === "alchemy:generate") {
          if (!["zh", "en"].includes(message.language)) throw new Error("无效提示词语言");
          return bridge(path, token, { language: message.language });
        }
        if (typeof message.generationId !== "string" || !/^[\da-f-]{36}$/.test(message.generationId)) throw new Error("无效生图记录");
        return message.type === "alchemy:generation-image"
          ? bridge(`${path}/${message.generationId}/image`, token)
          : bridge(`${path}/${message.generationId}/cancel`, token, {});
      }
      case "alchemy:start":
        return start(message.id, message.mode, message.referenceJobId, message.reenact);
    }
  };
  browser.runtime.onMessage.addListener((message, sender, reply) => {
    // Only extension pages and this extension's top-frame content scripts.
    if (sender.id !== browser.runtime.id) return;
    const contentSender = sender.tab?.id != null && sender.frameId === 0 && /^https?:/.test(sender.url || sender.tab.url || "");
    const extensionSender = sender.url?.startsWith(browser.runtime.getURL("/"));
    if ((contentSender || extensionSender) && ["alchemy:state", "alchemy:connect", "alchemy:mode", "alchemy:query", "alchemy:cancel", "alchemy:reference", "alchemy:start", "alchemy:generate", "alchemy:generation-cancel", "alchemy:generation-image"].includes(message?.type)) {
      uiMessage(message).then(
        (value) => reply({ ok: true, value }),
        (error) => reply({ error: error.message }),
      );
      return true;
    }
    if (message?.type !== "alchemy:select" || !contentSender) return;
    const tab = sender.tab;
    select(message.target, {
      id: tab!.id!,
      windowId: tab!.windowId,
      url: tab!.url,
    }).then(
      () => reply({ ok: true }),
      (error) => reply({ error: error.message }),
    );
    return true;
  });
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== "alchemy-image" || !info.srcUrl || !tab?.id) return;
    void select(
      { src: info.srcUrl },
      { id: tab.id, windowId: tab.windowId, url: tab.url },
    ).catch(() => {});
  });
});
