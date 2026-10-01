import { createRoot } from "react-dom/client";
import { Liquid } from "liquid-gooey";
import type { MenuOffsets } from "./image-menu-placement";

export type LiquidState = { offsets: MenuOffsets; open: boolean; instant: boolean };
export const liquidTiming = { duration: 240, ease: "cubic-bezier(.23,1,.32,1)" };

// Only the surfaces merge. The native controls and their focus stay in content.ts.
export function CollectionLiquid({ offsets, open, instant }: LiquidState) {
  const transition = instant ? { duration: 0 } : liquidTiming;
  return <Liquid blur={6} contrast={18} fill="var(--yellow)" shadow="0 2px 6px rgba(20,17,17,.1)" filterPadding={192} aria-hidden="true" style={{ width: 40, height: 40, pointerEvents: "none" }}>
    {offsets.map(({ x, y }, index) => <Liquid.Item key={index} radius={20} x={open ? x : 0} y={open ? y : 0} scale={open ? 1 : 0} transition={transition} style={{ position: "absolute", width: 40, height: 40 }} />)}
  </Liquid>;
}

export function mountCollectionLiquid(element: HTMLElement) {
  const root = createRoot(element);
  let previous = "";
  return {
    update(state: LiquidState) {
      const next = JSON.stringify(state);
      if (next === previous) return;
      previous = next;
      root.render(<CollectionLiquid {...state} />);
    },
    dispose: () => root.unmount(),
  };
}
