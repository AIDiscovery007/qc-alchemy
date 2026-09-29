import { browser } from "wxt/browser";
import type { Mode, Selection } from "./types";

export type UiState = {
  preferences: { paired: boolean; mode: Mode };
  selection?: Selection;
};

export async function request<T>(message: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    const response = await Promise.race([
      browser.runtime.sendMessage(message),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("扩展响应超时，请重新加载扩展并刷新网页。")), 35_000);
      }),
    ]);
    if (!response) throw new Error("扩展未响应，请重新加载扩展并刷新网页。");
    if (response.error) throw new Error(response.error);
    return response.value as T;
  } catch (error) {
    if (/context invalidated|receiving end does not exist/i.test(String(error)))
      throw new Error("扩展已更新或连接已失效，请刷新当前网页后重试。");
    throw error;
  } finally {
    clearTimeout(timer!);
  }
}

export const readState = (selectionId?: string, selectionJobId?: string) =>
  request<UiState>({ type: "alchemy:state", selectionId, selectionJobId });

export const query = <T>(path: string) =>
  request<T>({ type: "alchemy:query", path });
