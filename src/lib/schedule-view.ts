import { at } from "@/lib/time";
import type { Conflict, Placement, ScheduleRow, Task } from "@/lib/types";

export interface Band {
  id: "tonight" | "tomorrow";
  title: string;
  startMin: number;
  endMin: number;
  ticks: { minute: number; label: string }[];
}

export const TONIGHT: Band = {
  id: "tonight",
  title: "Tonight",
  startMin: at(0, 16, 0),
  endMin: at(0, 23, 0),
  ticks: [
    { minute: at(0, 16, 0), label: "4 PM" },
    { minute: at(0, 18, 0), label: "6 PM" },
    { minute: at(0, 20, 0), label: "8 PM" },
    { minute: at(0, 22, 0), label: "10 PM" },
  ],
};

export const TOMORROW: Band = {
  id: "tomorrow",
  title: "Tomorrow",
  startMin: at(1, 6, 30),
  endMin: at(1, 14, 30),
  ticks: [
    { minute: at(1, 7, 0), label: "7 AM" },
    { minute: at(1, 9, 0), label: "9 AM" },
    { minute: at(1, 11, 0), label: "11 AM" },
    { minute: at(1, 13, 0), label: "1 PM" },
  ],
};

export function placementMap(placements: Placement[]): Map<string, Placement> {
  return new Map(placements.map((placement) => [placement.taskId, placement]));
}

function isLive(placement: Placement | undefined): placement is Placement {
  return placement != null && placement.status !== "dropped" && placement.status !== "unresolved";
}

export function buildRows(
  tasks: Task[],
  accepted: Placement[],
  proposed: Placement[] | null,
  conflicts: Conflict[],
): ScheduleRow[] {
  const acceptedById = placementMap(accepted);
  const proposedById = proposed ? placementMap(proposed) : null;
  const conflictIds = new Set(conflicts.flatMap((conflict) => conflict.taskIds));
  const ids = new Set<string>([
    ...tasks.map((task) => task.id),
    ...accepted.map((placement) => placement.taskId),
    ...(proposed ?? []).map((placement) => placement.taskId),
  ]);

  const rows: ScheduleRow[] = [];
  for (const taskId of ids) {
    const task = tasks.find((item) => item.id === taskId);
    const beforePlacement = acceptedById.get(taskId);
    const afterPlacement = proposedById?.get(taskId);
    const before = isLive(beforePlacement)
      ? { startMin: beforePlacement.startMin, endMin: beforePlacement.endMin }
      : null;
    const after = isLive(afterPlacement)
      ? { startMin: afterPlacement.startMin, endMin: afterPlacement.endMin }
      : null;
    if (!before && !after && afterPlacement?.status !== "unresolved" && afterPlacement?.status !== "dropped") {
      continue;
    }

    let change: ScheduleRow["change"] = "same";
    if (!proposed) {
      change = "same";
    } else if (afterPlacement?.status === "dropped") {
      change = "removed";
    } else if (afterPlacement?.status === "unresolved" || (!after && before)) {
      change = afterPlacement?.status === "unresolved" ? "unresolved" : "removed";
    } else if (after && !before) {
      change = "added";
    } else if (after && before) {
      const shorter = after.endMin - after.startMin < before.endMin - before.startMin;
      if (shorter) change = "shortened";
      else if (after.startMin !== before.startMin || after.endMin !== before.endMin) change = "moved";
      else change = "same";
    }

    rows.push({
      taskId,
      title: task?.title ?? taskId,
      detail: task?.detail ?? "",
      location: task?.location,
      priority: task?.priority ?? "medium",
      flexibility: task?.flexibility ?? "movable",
      optional: Boolean(task?.optional),
      before,
      after,
      change,
      note: afterPlacement?.note || beforePlacement?.note || "",
      conflict: conflictIds.has(taskId),
    });
  }

  return rows.sort((a, b) => sortKey(a) - sortKey(b) || a.title.localeCompare(b.title));
}

function sortKey(row: ScheduleRow): number {
  return row.after?.startMin ?? row.before?.startMin ?? Number.MAX_SAFE_INTEGER;
}

export function rowsInBand(rows: ScheduleRow[], band: Band, side: "before" | "after"): ScheduleRow[] {
  return rows.filter((row) => {
    const span = side === "before" ? row.before : row.after;
    if (!span) return false;
    return span.endMin > band.startMin && span.startMin < band.endMin;
  });
}

export function changedFromOpening(opening: Placement[], current: Placement[]): { taskId: string; from: string; to: string }[] {
  const currentById = placementMap(current);
  const changes: { taskId: string; from: string; to: string }[] = [];
  const ids = new Set([...opening.map((item) => item.taskId), ...current.map((item) => item.taskId)]);
  for (const taskId of ids) {
    const before = opening.find((item) => item.taskId === taskId);
    const after = currentById.get(taskId);
    const beforeLive = isLive(before) ? before : undefined;
    const afterLive = isLive(after) ? after : undefined;
    if (!beforeLive && afterLive) {
      changes.push({ taskId, from: "not on the sample start", to: "added" });
      continue;
    }
    if (beforeLive && !afterLive) {
      changes.push({ taskId, from: "scheduled", to: "removed" });
      continue;
    }
    if (beforeLive && afterLive && (beforeLive.startMin !== afterLive.startMin || beforeLive.endMin !== afterLive.endMin)) {
      changes.push({ taskId, from: `${beforeLive.startMin}`, to: `${afterLive.startMin}` });
    }
  }
  return changes;
}
