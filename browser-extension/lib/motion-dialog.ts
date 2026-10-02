/** Open immediately; motion never owns focus, dismissal or business state. */
export function showMotionDialog(element: HTMLDialogElement) {
  const previous = (element.getRootNode() as Document | ShadowRoot).activeElement;
  const trigger = previous instanceof HTMLElement && previous.getClientRects().length ? previous.getBoundingClientRect() : null;
  element.setAttribute("closedby", "any");
  // Older browsers need light-dismiss routed through the same cancel guards as Escape.
  let backdropPointer: number | undefined;
  const outside = (event: MouseEvent) => {
    const rect = element.getBoundingClientRect();
    return event.target === element && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  const reset = () => { backdropPointer = undefined; };
  const down = (event: PointerEvent) => { backdropPointer = event.button === 0 && event.isPrimary && outside(event) ? event.pointerId : undefined; };
  const dismiss = (event: PointerEvent) => {
    const requested = backdropPointer !== undefined && backdropPointer === event.pointerId && outside(event);
    reset();
    if (requested && element.open && element.dispatchEvent(new Event("cancel", { cancelable: true }))) element.close();
  };
  const fallback = !("closedBy" in element);
  if (fallback) {
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointercancel", reset);
    element.addEventListener("click", dismiss);
  }
  element.showModal();
  // Use layout coordinates, unaffected by the entrance transform.
  if (trigger) {
    const x = Math.max(0, Math.min(element.offsetWidth, trigger.x + trigger.width / 2 - element.offsetLeft));
    const y = Math.max(0, Math.min(element.offsetHeight, trigger.y + trigger.height / 2 - element.offsetTop));
    element.style.setProperty("--dialog-origin", `${x}px ${y}px`);
  }
  return () => {
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("pointercancel", reset);
    element.removeEventListener("click", dismiss);
    if (!element.open) return;
    element.close();
    if (previous instanceof HTMLElement && previous.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
  };
}
