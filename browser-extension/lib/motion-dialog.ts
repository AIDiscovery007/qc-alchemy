/** Open immediately; motion never owns focus, dismissal or business state. */
export function showMotionDialog(element: HTMLDialogElement) {
  const previous = (element.getRootNode() as Document | ShadowRoot).activeElement;
  const trigger = previous instanceof HTMLElement && previous.getClientRects().length ? previous.getBoundingClientRect() : null;
  element.showModal();
  // Use layout coordinates, unaffected by the entrance transform.
  if (trigger) {
    const x = Math.max(0, Math.min(element.offsetWidth, trigger.x + trigger.width / 2 - element.offsetLeft));
    const y = Math.max(0, Math.min(element.offsetHeight, trigger.y + trigger.height / 2 - element.offsetTop));
    element.style.setProperty("--dialog-origin", `${x}px ${y}px`);
  }
  return () => {
    if (!element.open) return;
    element.close();
    if (previous instanceof HTMLElement && previous.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
  };
}
