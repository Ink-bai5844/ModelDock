export type SortMovePosition = "before" | "after";

export interface SortMoveIntent {
  key: string;
  position: SortMovePosition;
  targetId: string;
}

export function getSortMoveIntent(
  ids: readonly string[],
  draggedId: string,
  targetId: string,
): SortMoveIntent | null {
  const fromIndex = ids.indexOf(draggedId);
  const toIndex = ids.indexOf(targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null;

  const position: SortMovePosition =
    fromIndex < toIndex ? "after" : "before";
  return {
    key: `${targetId}:${position}`,
    position,
    targetId,
  };
}

export function moveItemById<T extends { id: string }>(
  items: T[],
  draggedId: string,
  targetId: string,
): T[] {
  const fromIndex = items.findIndex((item) => item.id === draggedId);
  const toIndex = items.findIndex((item) => item.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return items;

  const reordered = [...items];
  const [dragged] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, dragged);
  return reordered;
}
