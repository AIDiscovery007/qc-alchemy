export type Box = { left: number; top: number; right: number; bottom: number };
export type ActionPlacement = Box & { compact: boolean };
const gap = 10; // Includes the button's hard shadow and focus ring.
const overlaps = (a: Box, b: Box, space = 0) =>
  a.left < b.right + space && a.right > b.left - space && a.top < b.bottom + space && a.bottom > b.top - space;

/** Keep the action inside the visible image; never cover a known control. */
export function placeImageAction(
  image: Box, viewport: Box, size: { width: number; height: number }, obstacles: Box[],
  previous?: ActionPlacement, isClear: (box: Box) => boolean = () => true,
): ActionPlacement | undefined {
  const bounds = {
    left: Math.max(image.left, viewport.left) + gap,
    top: Math.max(image.top, viewport.top) + gap,
    right: Math.min(image.right, viewport.right) - gap,
    bottom: Math.min(image.bottom, viewport.bottom) - gap,
  };
  const fits = (box: Box) => box.left >= bounds.left && box.top >= bounds.top &&
    box.right <= bounds.right && box.bottom <= bounds.bottom &&
    !obstacles.some(obstacle => overlaps(box, obstacle, gap)) && isClear(box);
  if (previous && fits(previous)) return previous;
  for (const compact of [false, true]) {
    const width = compact ? 40 : size.width, height = compact ? 40 : size.height;
    const left = bounds.left, right = bounds.right - width;
    const top = bounds.top, bottom = bounds.bottom - height;
    if (right < left || bottom < top) continue;
    const points: [number, number][] = [[right, top], [left, top], [right, bottom], [left, bottom]];
    for (const obstacle of obstacles) {
      for (const y of [obstacle.top, obstacle.bottom - height])
        points.push([obstacle.left - gap - width, y], [obstacle.right + gap, y]);
      for (const x of [obstacle.right - width, obstacle.left, right, left])
        points.push([x, obstacle.bottom + gap], [x, obstacle.top - gap - height]);
    }
    // Edge samples also let viewport overlays (outside the image card) be avoided.
    for (let y = top + height + gap; y < bottom; y += height + gap)
      points.push([right, y], [left, y]);
    const seen = new Set<string>();
    const candidates = points.map(([x, y]): [number, number] => [Math.max(left, Math.min(right, x)), Math.max(top, Math.min(bottom, y))])
      .sort((a, b) => (right - a[0] + (a[1] - top) * 2) - (right - b[0] + (b[1] - top) * 2));
    for (const [x, y] of candidates) {
      const key = `${x}:${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const box = { left: x, top: y, right: x + width, bottom: y + height, compact };
      if (fits(box)) return box;
    }
  }
}

const controls = 'button,a[href],input,select,textarea,summary,[role="button"],[role="checkbox"],[role="link"],[role="menuitem"],[role="switch"],[role="combobox"],[tabindex],[contenteditable="true"]';

export function imageActionEnvironment(image: Element, host: Element) {
  const imageBox = image.getBoundingClientRect();
  let scope = image.parentElement || image;
  // Some sites wrap images many times. Stop before reaching the feed/grid.
  for (let parent = scope.parentElement, depth = 0; parent && depth < 24; parent = parent.parentElement, depth++) {
    if (parent === document.body || parent === document.documentElement) break;
    const box = parent.getBoundingClientRect();
    if (box.width > imageBox.width * 1.6 + 40 || box.height > imageBox.height * 1.6 + 80) break;
    scope = parent;
  }
  const isImageLink = (element: Element, box: DOMRect) => element.contains(image) ||
    (box.width >= imageBox.width * .9 && box.height >= imageBox.height * .9 &&
      element.matches('a,[role="link"],[role="button"]'));
  const visible = (element: Element) => {
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const obstacles: Box[] = [];
  for (const element of [...scope.querySelectorAll(controls)].slice(0, 200)) {
    const box = element.getBoundingClientRect();
    if (box.width && box.height && overlaps(box, imageBox, gap) && !isImageLink(element, box) && visible(element)) obstacles.push(box);
  }
  const isClear = (box: Box) => {
    for (const x of [box.left + 1, (box.left + box.right) / 2, box.right - 1]) {
      for (const y of [box.top + 1, (box.top + box.bottom) / 2, box.bottom - 1]) {
        const top = document.elementsFromPoint(x, y).find(element => element !== host && !host.contains(element));
        if (!top) return false;
        const control = top.closest(controls);
        if (control && !isImageLink(control, control.getBoundingClientRect())) return false;
        if (!scope.contains(top) && !top.contains(image)) return false;
        // Custom icon buttons may have a pointer cursor without semantic markup.
        if (!top.contains(image) && getComputedStyle(top).cursor === "pointer") {
          const rect = top.getBoundingClientRect();
          if (rect.width < imageBox.width * .9 && rect.height < imageBox.height * .9) return false;
        }
      }
    }
    return true;
  };
  return { obstacles, isClear };
}
