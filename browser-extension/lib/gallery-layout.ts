export type GallerySize = { id: string; width: number; height: number };

export function galleryLayout<T extends GallerySize>(items: T[], width: number, dense: boolean) {
  const gap = dense ? 12 : 18;
  const cols = Math.max(1, Math.floor((width + gap) / (dense ? 180 : 235)));
  const cell = Math.max(1, (width - gap * (cols - 1)) / cols), heights: number[] = Array(cols).fill(0);
  const rects = items.map(work => {
    const col = heights.indexOf(Math.min(...heights)), y = heights[col]!;
    const height = cell * work.height / work.width + 52;
    heights[col] = y + height + gap;
    return { work, x: col * (cell + gap), y, width: cell, height };
  });
  return { rects, height: Math.max(0, ...heights), cols, width, gap, items };
}

export function galleryAnchor<T extends GallerySize>(old: ReturnType<typeof galleryLayout<T>>, next: ReturnType<typeof galleryLayout<T>>, top: number) {
  const anchor = old.rects.find(rect => rect.y + rect.height > top);
  const target = anchor && next.rects.find(rect => rect.work.id === anchor.work.id);
  return anchor && target ? target.y + (top - anchor.y) * target.height / anchor.height : top;
}
