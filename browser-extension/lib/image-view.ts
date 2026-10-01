export type View = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };

export function constrainView(view: View, frame: Size, image: Size): View {
  const scale = Math.max(1, Math.min(8, view.scale));
  const x = Math.max(0, (image.width * scale - frame.width) / 2);
  const y = Math.max(0, (image.height * scale - frame.height) / 2);
  return { scale, x: Math.max(-x, Math.min(x, view.x)), y: Math.max(-y, Math.min(y, view.y)) };
}

export function zoomView(view: View, scale: number, anchor = { x: 0, y: 0 }): View {
  scale = Math.max(1, Math.min(8, scale));
  const ratio = scale / view.scale;
  return { scale, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio };
}
