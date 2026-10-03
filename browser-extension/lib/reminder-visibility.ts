// Check the actual result, including scrolling containers across content-script shadow roots.
export function isReminderVisible(element: HTMLElement): boolean {
  let { left, top, right, bottom } = element.getBoundingClientRect();
  if (element.tagName === 'IMG') {
    const image = element as HTMLImageElement;
    if (!image.complete || !image.naturalWidth) return false;
    // ImagePreview positions this anchor over the rendered pixels, excluding contain letterboxing.
    const anchor = image.closest('.image-preview')?.querySelector<HTMLElement>('.image-preview-anchor:not([hidden])');
    if (!anchor) return false;
    ({ left, top, right, bottom } = anchor.getBoundingClientRect());
  }
  left = Math.max(left, 0); top = Math.max(top, 0);
  right = Math.min(right, innerWidth); bottom = Math.min(bottom, innerHeight);
  for (let node: HTMLElement | null = element; node;) {
    const style = getComputedStyle(node);
    if (node.matches('[inert], [hidden], [aria-hidden="true"]') || style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return false;
    if (node !== element) {
      const rect = node.getBoundingClientRect();
      const scaleX = node.offsetWidth ? rect.width / node.offsetWidth : 1;
      const scaleY = node.offsetHeight ? rect.height / node.offsetHeight : 1;
      const x = rect.left + node.clientLeft * scaleX, y = rect.top + node.clientTop * scaleY;
      if (/^(auto|scroll|hidden|clip)$/.test(style.overflowX)) { left = Math.max(left, x); right = Math.min(right, x + node.clientWidth * scaleX); }
      if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY)) { top = Math.max(top, y); bottom = Math.min(bottom, y + node.clientHeight * scaleY); }
    }
    node = node.parentElement || (node.getRootNode() as ShadowRoot).host as HTMLElement | null;
  }
  return right > left && bottom > top;
}
