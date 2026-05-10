import { isTauriDesktop } from "@/lib/runtime";

type DragPosition = {
  x: number;
  y: number;
};

type TauriDragDropPayload =
  | {
      type: "over";
      position: DragPosition;
    }
  | {
      type: "drop";
      paths: string[];
      position: DragPosition;
    }
  | {
      type: "leave";
    };

export type TauriDragDropEvent = {
  payload: TauriDragDropPayload;
};

export async function listenToTauriDragDrop(
  handler: (event: TauriDragDropEvent) => void,
): Promise<(() => void) | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return await getCurrentWindow().onDragDropEvent((event) => {
      handler(event as TauriDragDropEvent);
    });
  } catch {
    return null;
  }
}

function pointInsideElement(element: HTMLElement, x: number, y: number): boolean {
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function findDropZoneForPosition<T extends string>(
  position: DragPosition,
  zones: Array<{ key: T; element: HTMLElement | null }>,
): T | null {
  if (typeof window === "undefined") {
    return null;
  }

  const scale = window.devicePixelRatio || 1;
  const candidatePoints: Array<{ x: number; y: number }> = [
    { x: position.x, y: position.y },
  ];

  if (scale !== 1) {
    candidatePoints.push({
      x: position.x / scale,
      y: position.y / scale,
    });
  }

  for (const point of candidatePoints) {
    for (const zone of zones) {
      if (zone.element && pointInsideElement(zone.element, point.x, point.y)) {
        return zone.key;
      }
    }
  }

  return null;
}
