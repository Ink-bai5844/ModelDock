import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getSortMoveIntent,
  type SortMovePosition,
} from "./reorder";

export { getSortMoveIntent, moveItemById } from "./reorder";

interface SortableListOptions {
  scope: string;
  ids: string[];
  disabled?: boolean;
  onMove: (draggedId: string, targetId: string) => void;
  onMoveEnd: () => void;
}

export function useSortableList({
  scope,
  ids,
  disabled = false,
  onMove,
  onMoveEnd,
}: SortableListOptions) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overPosition, setOverPosition] =
    useState<SortMovePosition | null>(null);
  const activeId = useRef<string | null>(null);
  const activePointerId = useRef<number | null>(null);
  const lastMoveKey = useRef<string | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const pointerOrigin = useRef({ x: 0, y: 0 });
  const moved = useRef(false);
  const suppressClick = useRef(false);
  const finishRef = useRef<() => void>(() => undefined);
  const moveOverRef = useRef<(targetId: string) => void>(() => undefined);

  const finish = () => {
    if (moved.current) {
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      onMoveEnd();
    }
    activeId.current = null;
    activePointerId.current = null;
    lastMoveKey.current = null;
    moved.current = false;
    setDraggedId(null);
    setOverId(null);
    setOverPosition(null);
  };

  const moveOver = (targetId: string) => {
    const currentId = activeId.current;
    if (!currentId) return;
    const intent = getSortMoveIntent(
      idsRef.current,
      currentId,
      targetId,
    );
    if (!intent || intent.key === lastMoveKey.current) return;

    lastMoveKey.current = intent.key;
    moved.current = true;
    setOverId(intent.targetId);
    setOverPosition(intent.position);
    onMove(currentId, targetId);
  };

  finishRef.current = finish;
  moveOverRef.current = moveOver;

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const currentId = activeId.current;
      if (
        disabled ||
        !currentId ||
        activePointerId.current !== event.pointerId
      ) {
        return;
      }
      const distance = Math.hypot(
        event.clientX - pointerOrigin.current.x,
        event.clientY - pointerOrigin.current.y,
      );
      if (distance < 6) return;
      event.preventDefault();
      moved.current = true;
      setDraggedId(currentId);
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>(
          `[data-sort-scope="${scope}"][data-sort-id]`,
        );
      const targetId = target?.dataset.sortId;
      if (targetId) moveOverRef.current(targetId);
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (activePointerId.current === event.pointerId) {
        finishRef.current();
      }
    };

    const handleWindowBlur = () => {
      if (activeId.current) finishRef.current();
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [disabled, scope]);

  const itemProps = (id: string) => ({
    "data-sort-scope": scope,
    "data-sort-id": id,
    "aria-keyshortcuts": disabled
      ? undefined
      : "Alt+ArrowUp Alt+ArrowDown",
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (
        disabled ||
        !event.altKey ||
        (event.key !== "ArrowUp" && event.key !== "ArrowDown")
      ) {
        return;
      }
      const index = ids.indexOf(id);
      const targetIndex = index + (event.key === "ArrowUp" ? -1 : 1);
      const targetId = ids[targetIndex];
      if (!targetId) return;
      event.preventDefault();
      onMove(id, targetId);
      onMoveEnd();
    },
  });

  const gripProps = (id: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled || event.button !== 0) return;
      activeId.current = id;
      activePointerId.current = event.pointerId;
      lastMoveKey.current = null;
      moved.current = false;
      pointerOrigin.current = { x: event.clientX, y: event.clientY };
      setDraggedId(id);
      setOverId(null);
      setOverPosition(null);
    },
  });

  return {
    draggedId,
    overId,
    overPosition,
    itemProps,
    gripProps,
    consumeClick: () => suppressClick.current,
  };
}
