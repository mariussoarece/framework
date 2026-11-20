// Moving an item inside a list (drag-and-drop). Pure, tested.

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice();
  if (from < 0 || from >= out.length) return out;
  const target = Math.max(0, Math.min(out.length - 1, to));
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item);
  return out;
}

// Where a dragged row lands: start index + rows moved, kept inside the list.
export function dropIndex(start: number, dy: number, rowHeight: number, count: number): number {
  return Math.max(0, Math.min(count - 1, start + Math.round(dy / rowHeight)));
}

// How far another row moves aside while one is dragged from `from` over `hover`.
export function shiftFor(index: number, from: number, hover: number, rowHeight: number): number {
  if (from < hover && index > from && index <= hover) return -rowHeight;
  if (from > hover && index < from && index >= hover) return rowHeight;
  return 0;
}
