import type { Box } from "./image-action-placement";

export type MenuOffset = { x: number; y: number };
export type MenuOffsets = [MenuOffset, MenuOffset, MenuOffset];

/** Keep all three 40px actions inside the visible image, clear of the trigger and page controls. */
export function placeImageMenu(image: Box, viewport: Box, trigger: Box, obstacles: Box[] = [], isClear: (box: Box) => boolean = () => true, previous?: MenuOffsets): MenuOffsets | undefined {
  const bounds = { left: Math.max(image.left, viewport.left) + 8, top: Math.max(image.top, viewport.top) + 8,
    right: Math.min(image.right, viewport.right) - 8, bottom: Math.min(image.bottom, viewport.bottom) - 8 };
  const overlaps = (a: Box, b: Box) => a.left < b.right + 6 && a.right > b.left - 6 && a.top < b.bottom + 6 && a.bottom > b.top - 6;
  const box = ({ x, y }: MenuOffset): Box => ({ left: trigger.left + x, top: trigger.top + y, right: trigger.left + x + 40, bottom: trigger.top + y + 40 });
  const fits = (r: Box) => r.left >= bounds.left && r.top >= bounds.top && r.right <= bounds.right && r.bottom <= bounds.bottom &&
    !overlaps(r, trigger) && !obstacles.some(obstacle => overlaps(r, obstacle));
  const inward = Math.atan2((bounds.top + bounds.bottom) / 2 - trigger.top - 20, (bounds.left + bounds.right) / 2 - trigger.left - 20);
  const directions = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4)
    .sort((a, b) => Math.cos(b - inward) - Math.cos(a - inward));
  const point = (angle: number, distance: number): MenuOffset => ({ x: Math.round(Math.cos(angle) * distance), y: Math.round(Math.sin(angle) * distance) });
  const valid = (offsets: MenuOffsets) => {
    const boxes = offsets.map(box);
    return boxes.every((rect, index) => fits(rect) && isClear(rect) && boxes.slice(index + 1).every(other => !overlaps(rect, other)));
  };
  if (previous && valid(previous)) return previous;
  // Try a small fan first; straight layouts cover narrow/tall or short/wide images.
  for (const fan of [true, false]) for (const direction of directions) {
    const offsets: MenuOffsets = fan ? [point(direction - Math.PI / 6, 68), point(direction + Math.PI / 6, 68), point(direction, 116)]
      : [point(direction, 52), point(direction, 104), point(direction, 156)];
    if (valid(offsets)) return offsets;
  }
}
