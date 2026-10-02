import { browser } from "wxt/browser";
import { request } from "./client";

export type MotionPreference = "system" | "reduce" | "full";
const media = matchMedia("(prefers-reduced-motion: reduce)");
const listeners = new Set<() => void>();
const normalize = (value: unknown): MotionPreference => value === "reduce" || value === "full" ? value : "system";
let state = { preference: "system" as MotionPreference, reduced: media.matches };
export const getMotion = () => state;

function update(preference = state.preference) {
  const reduced = preference === "reduce" || (preference === "system" && media.matches);
  if (preference === state.preference && reduced === state.reduced) return;
  state = { preference, reduced };
  listeners.forEach(listener => listener());
}

let stop: (() => void) | undefined;
export function subscribeMotion(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      try {
        const preference = await request<MotionPreference>({ type: "alchemy:get-motion-preference" });
        if (current === revision) update(normalize(preference));
      } catch { /* Keep the current preference if the extension is unavailable. */ }
    };
    const onMedia = () => update();
    const onMessage = (message: { type?: string }, sender: { id?: string }) => {
      if (sender.id === browser.runtime.id && message?.type === "alchemy:motion-changed") void refresh();
    };
    media.addEventListener("change", onMedia);
    browser.runtime.onMessage.addListener(onMessage);
    update();
    void refresh();
    stop = () => {
      revision++;
      media.removeEventListener("change", onMedia);
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { stop?.(); stop = undefined; }
  };
}

export async function setMotionPreference(preference: MotionPreference) {
  await request({ type: "alchemy:set-motion-preference", preference });
}
