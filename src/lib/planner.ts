import { cloneTask } from "@/lib/tasks";
import { formatClock, formatRange, HORIZON_END } from "@/lib/time";
import type {
  Conflict,
  Disruption,
  Placement,
  Proposal,
  ProposalResult,
  SolvedPlan,
  Task,
} from "@/lib/types";

/**
 * Deterministic day planner.
 *
 * Pipeline for every recovery:
 * 1. Pin fixed appointments and protected blocks (including sleep).
 * 2. Place travel so it finishes the arrival buffer before its anchor.
 * 3. Optionally shorten or release a protected block that now overlaps.
 * 4. Place tight windows (a train, a morning routine) before long tasks.
 * 5. Optionally reserve a preferred meal if deadlines still fit.
 * 6. Place everything else by priority, then deadline.
 * 7. Keep a previous time when it still satisfies the rules.
 * 8. If a required task cannot fit, say so. Do not invent an overlap.
 *
 * New sample events should arrive as a Disruption (move a fixed task,
 * extend travel, or add a task). applyDisruption is the only branch
 * that turns that input into task properties. solve() then reads
 * duration, priority, deadline, earliest start, flexibility, and dependencies.
 */

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;
const TIGHT_SLACK_MIN = 90;
const MIN_KEEP_MIN = 20;

interface Strategy {
  id: string;
  allowProtectedMoves: boolean;
  clipProtected: boolean;
  /** Arrive before the earliest on-campus pin, not only the presentation. */
  earliestCampusAnchor: boolean;
  /** Drop an optional task that would start after its preferred morning cutoff. */
  dropLateOptional: boolean;
  protectPreferences: boolean;
}

const STRATEGIES: Strategy[] = [
  {
    id: "earliest",
    allowProtectedMoves: false,
    clipProtected: false,
    earliestCampusAnchor: false,
    dropLateOptional: false,
    protectPreferences: false,
  },
  {
    id: "release",
    allowProtectedMoves: true,
    clipProtected: false,
    earliestCampusAnchor: false,
    dropLateOptional: false,
    protectPreferences: false,
  },
  {
    id: "clip",
    allowProtectedMoves: false,
    clipProtected: true,
    earliestCampusAnchor: true,
    dropLateOptional: false,
    protectPreferences: false,
  },
  {
    id: "dinner",
    allowProtectedMoves: true,
    clipProtected: false,
    earliestCampusAnchor: false,
    dropLateOptional: false,
    protectPreferences: true,
  },
  {
    id: "simpler",
    allowProtectedMoves: true,
    clipProtected: false,
    earliestCampusAnchor: false,
    dropLateOptional: true,
    protectPreferences: false,
  },
];

interface Interval {
  taskId: string;
  start: number;
  end: number;
}

interface Working {
  tasks: Task[];
  taskById: Map<string, Task>;
  occupied: Interval[];
  placements: Placement[];
  conflicts: Conflict[];
  baseline: Placement[];
  disruption: Disruption | null;
  strategy: Strategy;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function baselineOf(working: Working, taskId: string): Placement | undefined {
  return working.baseline.find(
    (placement) =>
      placement.taskId === taskId &&
      placement.status !== "dropped" &&
      placement.status !== "unresolved",
  );
}

function placementOf(working: Working, taskId: string): Placement | undefined {
  return working.placements.find(
    (placement) => placement.status !== "dropped" && placement.status !== "unresolved" && placement.taskId === taskId,
  );
}

function hits(working: Working, start: number, end: number, ignoreId?: string): Interval[] {
  return working.occupied.filter(
    (interval) => interval.taskId !== ignoreId && overlaps(start, end, interval.start, interval.end),
  );
}

function addConflict(working: Working, conflict: Conflict): void {
  if (working.conflicts.some((item) => item.id === conflict.id)) return;
  working.conflicts.push(conflict);
}

function earliestFor(working: Working, task: Task): number {
  let earliest = task.earliestStartMin;
  for (const dependencyId of task.dependsOn) {
    const dependency = placementOf(working, dependencyId);
    if (dependency) earliest = Math.max(earliest, dependency.endMin);
  }
  return earliest;
}

function latestFor(working: Working, task: Task): number {
  let latest = task.latestEndMin ?? HORIZON_END;
  if (task.deadlineMin != null) latest = Math.min(latest, task.deadlineMin);
  if (task.finishBeforeTaskId) {
    const blocker = placementOf(working, task.finishBeforeTaskId);
    if (blocker) latest = Math.min(latest, blocker.startMin);
  }
  return latest;
}

function slackOf(working: Working, task: Task): number {
  return latestFor(working, task) - earliestFor(working, task) - task.durationMin;
}

function firstFit(occupied: Interval[], earliest: number, latestEnd: number, duration: number): number | null {
  let cursor = earliest;
  let guard = 0;
  while (cursor + duration <= latestEnd && guard < 1000) {
    guard += 1;
    const hit = occupied.find((interval) => overlaps(cursor, cursor + duration, interval.start, interval.end));
    if (!hit) return cursor;
    if (hit.end <= cursor) {
      cursor += 5;
      continue;
    }
    cursor = hit.end;
  }
  return null;
}

function statusFor(start: number, end: number, previous: Placement | undefined, hasBaseline: boolean): Placement["status"] {
  if (!hasBaseline || !previous) return hasBaseline ? "added" : "kept";
  const previousDuration = previous.endMin - previous.startMin;
  const nextDuration = end - start;
  if (nextDuration < previousDuration) return "shortened";
  if (previous.startMin !== start || nextDuration !== previousDuration) return "moved";
  return "kept";
}

function writePlacement(
  working: Working,
  task: Task,
  start: number,
  end: number,
  forced?: Placement["status"],
): void {
  const previous = baselineOf(working, task.id);
  const status = forced ?? statusFor(start, end, previous, working.baseline.length > 0);
  working.placements = working.placements.filter((placement) => placement.taskId !== task.id);
  working.occupied = working.occupied.filter((interval) => interval.taskId !== task.id);
  working.placements.push({ taskId: task.id, startMin: start, endMin: end, status, note: "" });
  if (status !== "dropped" && status !== "unresolved") {
    working.occupied.push({ taskId: task.id, start, end });
  }
}

function chooseSlot(working: Working, task: Task, duration: number, earliest: number, latest: number): number | null {
  const previous = baselineOf(working, task.id);
  if (previous) {
    const sameDuration = previous.endMin - previous.startMin === duration;
    const inside = previous.startMin >= earliest && previous.endMin <= latest;
    const free = hits(working, previous.startMin, previous.endMin, task.id).length === 0;
    // Keep the accepted time when it still meets every hard rule.
    if (sameDuration && inside && free) return previous.startMin;
  }
  return firstFit(working.occupied, earliest, latest, duration);
}

function placePinned(working: Working, task: Task): void {
  if (task.pinnedStartMin == null) return;
  const start = task.pinnedStartMin;
  const end = start + task.durationMin;
  writePlacement(working, task, start, end);
}

function anchorStart(working: Working, task: Task): number | null {
  const primaryId = task.arrivesBeforeTaskId;
  if (!primaryId) return null;
  const primary = placementOf(working, primaryId);
  if (!primary) return null;
  if (!working.strategy.earliestCampusAnchor) return primary.startMin;

  const campusStarts = working.placements
    .filter((placement) => {
      const other = working.taskById.get(placement.taskId);
      return other?.onCampus && placement.status !== "dropped" && placement.status !== "unresolved";
    })
    .map((placement) => placement.startMin);
  if (campusStarts.length === 0) return primary.startMin;
  return Math.min(...campusStarts);
}

function placeTravel(working: Working, task: Task): void {
  const anchor = anchorStart(working, task);
  const buffer = task.arrivalBufferMin ?? 0;
  if (anchor == null) {
    writePlacement(working, task, task.earliestStartMin, task.earliestStartMin, "unresolved");
    addConflict(working, {
      id: `travel-anchor:${task.id}`,
      severity: "hard",
      taskIds: [task.id],
      message: `${task.title} has no appointment to arrive before, so it was not scheduled.`,
    });
    return;
  }

  const end = anchor - buffer;
  const start = end - task.durationMin;
  const blocking = hits(working, start, end, task.id).filter((interval) => {
    const other = working.taskById.get(interval.taskId);
    if (!other) return true;
    if (other.category === "rest" || other.flexibility === "fixed") return true;
    if (other.flexibility === "protected" && !working.strategy.allowProtectedMoves && !working.strategy.clipProtected) {
      return true;
    }
    return false;
  });

  if (start < task.earliestStartMin || blocking.length > 0) {
    writePlacement(working, task, start, end, "unresolved");
    const blocker = blocking[0] ? working.taskById.get(blocking[0].taskId) : undefined;
    const message = blocker
      ? `${task.title} would run through ${blocker.title}. There is not enough time to keep the ${buffer}-minute arrival buffer, so this version is not possible.`
      : `There is not enough time before the appointment for ${task.title} and the ${buffer}-minute arrival buffer.`;
    addConflict(working, {
      id: `travel-fit:${task.id}`,
      severity: "hard",
      taskIds: [task.id, blocker?.id ?? task.arrivesBeforeTaskId ?? task.id],
      message,
    });
    return;
  }

  writePlacement(working, task, start, end);
}

function clipProtected(working: Working): void {
  const protectedTasks = working.tasks.filter((task) => task.flexibility === "protected" && task.category !== "rest");
  for (const task of protectedTasks) {
    const current = placementOf(working, task.id);
    if (!current) continue;
    const overlapping = hits(working, current.startMin, current.endMin, task.id).sort((a, b) => a.start - b.start);
    if (overlapping.length === 0) continue;
    const cut = overlapping[0].start;
    const kept = cut - current.startMin;
    if (kept < MIN_KEEP_MIN || cut >= current.endMin) continue;
    writePlacement(working, task, current.startMin, cut, "shortened");
  }
}

function releaseProtected(working: Working): void {
  const protectedTasks = working.tasks.filter((task) => task.flexibility === "protected" && task.category !== "rest");
  for (const task of protectedTasks) {
    const current = placementOf(working, task.id);
    if (!current) continue;
    const overlapping = hits(working, current.startMin, current.endMin, task.id);
    if (overlapping.length === 0) continue;
    working.placements = working.placements.filter((placement) => placement.taskId !== task.id);
    working.occupied = working.occupied.filter((interval) => interval.taskId !== task.id);
  }
}

function releasedEarliest(working: Working, task: Task): number {
  // A released protected task should take the next open time AFTER the
  // block that displaced it, and after arrival if it is on campus.
  let earliest = earliestFor(working, task);
  if (task.pinnedStartMin != null) {
    const pinEnd = task.pinnedStartMin + task.durationMin;
    const displacedBy = working.occupied.filter((interval) =>
      overlaps(task.pinnedStartMin!, pinEnd, interval.start, interval.end),
    );
    for (const interval of displacedBy) earliest = Math.max(earliest, interval.end);
  }
  if (task.onCampus) {
    const travel = working.tasks.find((candidate) => candidate.category === "travel");
    const travelPlacement = travel ? placementOf(working, travel.id) : undefined;
    if (travelPlacement) earliest = Math.max(earliest, travelPlacement.endMin);
  }
  return earliest;
}

function dropPlacement(working: Working, task: Task): void {
  const previous = baselineOf(working, task.id);
  working.placements = working.placements.filter((placement) => placement.taskId !== task.id);
  working.occupied = working.occupied.filter((interval) => interval.taskId !== task.id);
  working.placements.push({
    taskId: task.id,
    startMin: previous?.startMin ?? task.earliestStartMin,
    endMin: previous?.endMin ?? task.earliestStartMin,
    status: "dropped",
    note: "",
  });
}

function unresolvedPlacement(working: Working, task: Task): void {
  working.placements = working.placements.filter((placement) => placement.taskId !== task.id);
  working.placements.push({
    taskId: task.id,
    startMin: task.earliestStartMin,
    endMin: task.earliestStartMin,
    status: "unresolved",
    note: "",
  });
  addConflict(working, {
    id: `unresolved:${task.id}`,
    severity: "hard",
    taskIds: [task.id],
    message: `${task.title} has no open block that fits its ${task.durationMin}-minute duration, deadline, and dependencies.`,
  });
}

function placeMovable(working: Working, task: Task, earliestOverride?: number): boolean {
  const earliest = earliestOverride ?? earliestFor(working, task);
  const latest = latestFor(working, task);
  const slot = chooseSlot(working, task, task.durationMin, earliest, latest);
  const tooLate =
    working.strategy.dropLateOptional &&
    task.optional &&
    task.preferLatestStartMin != null &&
    (slot == null || slot > task.preferLatestStartMin);

  if (tooLate) {
    dropPlacement(working, task);
    return true;
  }
  if (slot == null) {
    if (task.optional) {
      dropPlacement(working, task);
      return true;
    }
    unresolvedPlacement(working, task);
    return false;
  }
  writePlacement(working, task, slot, slot + task.durationMin);
  return true;
}

function unplaced(working: Working): Task[] {
  const placed = new Set(working.placements.map((placement) => placement.taskId));
  return working.tasks.filter((task) => !placed.has(task.id));
}

function requiredWouldFit(working: Working, reserved: { task: Task; start: number }): boolean {
  const sandbox = createWorking(working.tasks, working.strategy, working.baseline, working.disruption);
  sandbox.strategy = { ...working.strategy, protectPreferences: false, dropLateOptional: false };
  sandbox.occupied = working.occupied.map((interval) => ({ ...interval }));
  sandbox.placements = working.placements.map((placement) => ({ ...placement }));
  writePlacement(sandbox, reserved.task, reserved.start, reserved.start + reserved.task.durationMin);

  const pending = unplaced(sandbox)
    .filter((task) => !task.optional)
    .sort(compareTasks(sandbox));
  for (const task of pending) {
    const earliest = task.flexibility === "protected" ? releasedEarliest(sandbox, task) : earliestFor(sandbox, task);
    const fitted = placeMovable(sandbox, task, earliest);
    if (!fitted) return false;
  }
  return sandbox.conflicts.every((conflict) => conflict.severity !== "hard");
}

function reservePreferences(working: Working): void {
  const candidates = unplaced(working)
    .filter((task) => task.preferEndMin != null)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id.localeCompare(b.id));

  for (const task of candidates) {
    const earliest = Math.max(earliestFor(working, task), task.preferStartMin ?? earliestFor(working, task));
    const latest = Math.min(latestFor(working, task), task.preferEndMin ?? latestFor(working, task));
    const previous = baselineOf(working, task.id);
    let slot: number | null = null;
    if (
      previous &&
      previous.endMin - previous.startMin === task.durationMin &&
      previous.startMin >= earliest &&
      previous.endMin <= latest &&
      hits(working, previous.startMin, previous.endMin, task.id).length === 0
    ) {
      slot = previous.startMin;
    } else {
      slot = firstFit(working.occupied, earliest, latest, task.durationMin);
    }
    if (slot == null) continue;
    if (!requiredWouldFit(working, { task, start: slot })) continue;
    writePlacement(working, task, slot, slot + task.durationMin);
  }
}

function compareTasks(working: Working) {
  return (a: Task, b: Task) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    (a.deadlineMin ?? Number.POSITIVE_INFINITY) - (b.deadlineMin ?? Number.POSITIVE_INFINITY) ||
    slackOf(working, a) - slackOf(working, b) ||
    a.id.localeCompare(b.id);
}

function scanOverlaps(working: Working): void {
  const live = working.placements.filter(
    (placement) => placement.status !== "dropped" && placement.status !== "unresolved",
  );
  for (let index = 0; index < live.length; index += 1) {
    for (let inner = index + 1; inner < live.length; inner += 1) {
      const left = live[index];
      const right = live[inner];
      if (!overlaps(left.startMin, left.endMin, right.startMin, right.endMin)) continue;
      const leftTask = working.taskById.get(left.taskId);
      const rightTask = working.taskById.get(right.taskId);
      const pair = [left.taskId, right.taskId].sort();
      addConflict(working, {
        id: `overlap:${pair[0]}:${pair[1]}`,
        severity: "hard",
        taskIds: pair,
        message: `${leftTask?.title ?? left.taskId} (${formatRange(left.startMin, left.endMin)}) overlaps ${rightTask?.title ?? right.taskId} (${formatRange(right.startMin, right.endMin)}).`,
      });
    }
  }
}

function blockerName(working: Working, task: Task, previous: Placement | undefined): string | null {
  if (!previous) return null;
  const overlapping = hits(working, previous.startMin, previous.endMin, task.id);
  if (overlapping.length === 0) return null;
  return working.taskById.get(overlapping[0].taskId)?.title ?? null;
}

function explain(working: Working): void {
  for (const placement of working.placements) {
    const task = working.taskById.get(placement.taskId);
    if (!task) continue;
    placement.note = reasonFor(working, task, placement);
  }
}

/** Plain-language reason for one moved, added, or dropped block. No strategy names. */
function reasonFor(working: Working, task: Task, placement: Placement): string {
  const previous = baselineOf(working, task.id);
  const blocker = blockerName(working, task, previous);
  const anchor = task.arrivesBeforeTaskId ? working.taskById.get(task.arrivesBeforeTaskId) : undefined;
  const minutes = placement.endMin - placement.startMin;
  const arrival = anchor?.title ?? "the appointment";

  if (placement.status === "dropped") {
    return `${task.title} is optional, so this recovery leaves it off the day instead of pushing it later.`;
  }
  if (placement.status === "unresolved") {
    return `${task.title} does not fit before its deadline without running through sleep or a fixed appointment.`;
  }
  if (placement.status === "added") {
    return `${task.title} is added at ${formatClock(placement.startMin)}. That is the open time inside its window.`;
  }
  if (task.category === "travel" && working.disruption?.type === "extend-travel" && working.disruption.taskId === task.id) {
    const oldDuration = previous ? previous.endMin - previous.startMin : task.durationMin - working.disruption.addMin;
    const buffer = task.arrivalBufferMin ?? 0;
    const longer = `Traffic increased ${task.title} from ${oldDuration} to ${task.durationMin} minutes.`;
    if (previous && previous.startMin !== placement.startMin) {
      return `${longer} To arrive ${buffer} minutes before ${arrival}, departure moves from ${formatClock(previous.startMin)} to ${formatClock(placement.startMin)}.`;
    }
    return `${longer} Departure stays at ${formatClock(placement.startMin)} so you still arrive ${buffer} minutes before ${arrival}.`;
  }
  if (task.category === "travel" && previous && previous.startMin !== placement.startMin) {
    const buffer = task.arrivalBufferMin ?? 0;
    return `To arrive ${buffer} minutes before ${arrival}, departure moves from ${formatClock(previous.startMin)} to ${formatClock(placement.startMin)}.`;
  }
  if (task.flexibility === "fixed" && placement.status === "moved") {
    return `${task.title} moved to ${formatClock(placement.startMin)}.`;
  }
  if (task.flexibility === "protected" && placement.status === "moved") {
    const overlap = blocker
      ? `Your original ${task.title} overlaps with the new ${blocker} time. `
      : "";
    return `${overlap}Moving it to ${formatClock(placement.startMin)} keeps the full ${minutes} minutes. This stays put until you approve it.`;
  }
  if (placement.status === "shortened") {
    const lost = previous ? previous.endMin - previous.startMin - minutes : 0;
    return `${task.title} keeps its ${formatClock(placement.startMin)} start and ends at ${formatClock(placement.endMin)} so it does not run into ${blocker ?? "the next commitment"}. This cuts ${lost} minutes.`;
  }
  if (placement.status === "moved" && previous) {
    return blocker
      ? `${task.title} moves from ${formatClock(previous.startMin)} to ${formatClock(placement.startMin)} because ${blocker} now uses that time.`
      : `${task.title} moves from ${formatClock(previous.startMin)} to ${formatClock(placement.startMin)} so the rest of the day still fits.`;
  }
  return `${task.title} stays at ${formatClock(placement.startMin)}.`;
}

function scorePlan(working: Working, feasible: boolean): number {
  let score = feasible ? 10000 : 0;
  for (const placement of working.placements) {
    const task = working.taskById.get(placement.taskId);
    if (!task) continue;
    if (placement.status === "unresolved" || (placement.status === "dropped" && !task.optional)) {
      score -= 4000;
      continue;
    }
    if (placement.status === "dropped") {
      score -= 80;
      continue;
    }
    score += (4 - PRIORITY_RANK[task.priority]) * 120;
    const previous = baselineOf(working, task.id);
    if (previous) {
      score -= Math.abs(placement.startMin - previous.startMin) * 0.2;
      const lost = previous.endMin - previous.startMin - (placement.endMin - placement.startMin);
      if (lost > 0) score -= lost * 20;
    }
    if (task.flexibility === "protected" && placement.status === "moved") score -= 220;
    if (task.preferEndMin != null && placement.endMin > task.preferEndMin) {
      score -= (placement.endMin - task.preferEndMin) * 5;
    }
  }
  score -= working.conflicts.filter((conflict) => conflict.severity === "hard").length * 2500;
  return Math.round(score);
}

function createWorking(tasks: Task[], strategy: Strategy, baseline: Placement[], disruption: Disruption | null): Working {
  return {
    tasks,
    taskById: new Map(tasks.map((task) => [task.id, task])),
    occupied: [],
    placements: [],
    conflicts: [],
    baseline,
    disruption,
    strategy,
  };
}

export function solve(
  tasks: Task[],
  strategy: Strategy,
  baseline: Placement[],
  disruption: Disruption | null,
): SolvedPlan {
  const working = createWorking(tasks, strategy, baseline, disruption);

  const pinned = tasks
    .filter((task) => (task.flexibility === "fixed" || task.flexibility === "protected") && task.pinnedStartMin != null)
    .sort((a, b) => (a.pinnedStartMin ?? 0) - (b.pinnedStartMin ?? 0) || a.id.localeCompare(b.id));
  for (const task of pinned) placePinned(working, task);

  // Travel is placed before ordinary work so rehearsals and routines can
  // finish before the departure time.
  for (const task of tasks.filter((candidate) => candidate.arrivesBeforeTaskId)) {
    placeTravel(working, task);
  }

  if (strategy.clipProtected) clipProtected(working);
  if (strategy.allowProtectedMoves) releaseProtected(working);

  const tight = unplaced(working)
    .filter((task) => task.preferEndMin == null && slackOf(working, task) <= TIGHT_SLACK_MIN)
    .sort((a, b) => slackOf(working, a) - slackOf(working, b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id.localeCompare(b.id));
  for (const task of tight) placeMovable(working, task);

  if (strategy.protectPreferences) reservePreferences(working);

  const rest = unplaced(working).sort(compareTasks(working));
  for (const task of rest) {
    const earliest = task.flexibility === "protected" ? releasedEarliest(working, task) : undefined;
    placeMovable(working, task, earliest);
  }

  scanOverlaps(working);
  explain(working);

  const feasible =
    working.conflicts.every((conflict) => conflict.severity !== "hard") &&
    working.placements.every((placement) => placement.status !== "unresolved");

  return {
    id: strategy.id,
    title: strategy.id,
    tradeoff: "",
    placements: working.placements,
    conflicts: working.conflicts,
    feasible,
    score: scorePlan(working, feasible),
  };
}

function applyDisruption(tasks: Task[], disruption: Disruption): { ok: true; tasks: Task[] } | { ok: false; error: string } {
  if (disruption.type === "move-fixed") {
    const target = tasks.find((task) => task.id === disruption.taskId);
    if (!target || target.flexibility !== "fixed") {
      return { ok: false, error: "That appointment is not a fixed task on this plan." };
    }
    if (target.pinnedStartMin === disruption.newStartMin) {
      return { ok: false, error: `${target.title} is already at that time.` };
    }
    return {
      ok: true,
      tasks: tasks.map((task) =>
        task.id === disruption.taskId ? { ...task, pinnedStartMin: disruption.newStartMin } : cloneTask(task),
      ),
    };
  }

  if (disruption.type === "extend-travel") {
    const target = tasks.find((task) => task.id === disruption.taskId);
    if (!target || target.category !== "travel") {
      return { ok: false, error: "That task is not travel on this plan." };
    }
    if (disruption.addMin <= 0) {
      return { ok: false, error: "Travel time has to increase by a positive number of minutes." };
    }
    return {
      ok: true,
      tasks: tasks.map((task) =>
        task.id === disruption.taskId ? { ...task, durationMin: task.durationMin + disruption.addMin } : cloneTask(task),
      ),
    };
  }

  if (tasks.some((task) => task.id === disruption.task.id)) {
    return { ok: false, error: `${disruption.task.title} is already on the accepted plan.` };
  }
  return { ok: true, tasks: [...tasks.map(cloneTask), cloneTask(disruption.task)] };
}

function signature(plan: SolvedPlan): string {
  return plan.placements
    .map((placement) => `${placement.taskId}:${placement.status}:${placement.startMin}-${placement.endMin}`)
    .sort()
    .join("|");
}

function mechanicalIds(disruption: Disruption): Set<string> {
  if (disruption.type === "add-task") return new Set([disruption.task.id]);
  return new Set([disruption.taskId]);
}

function livePlacement(plan: SolvedPlan, taskId: string): Placement | undefined {
  return plan.placements.find((placement) => placement.taskId === taskId && placement.status !== "unresolved");
}

interface Change {
  taskId: string;
  change: Placement["status"] | "same";
}

function changesAgainst(plan: SolvedPlan, baseline: Placement[]): Change[] {
  const baselineIds = new Set(baseline.map((placement) => placement.taskId));
  const ids = new Set<string>([...baselineIds, ...plan.placements.map((placement) => placement.taskId)]);
  const changes: Change[] = [];
  for (const taskId of ids) {
    const next = plan.placements.find((placement) => placement.taskId === taskId);
    const previous = baseline.find((placement) => placement.taskId === taskId);
    if (!next) {
      changes.push({ taskId, change: "dropped" });
      continue;
    }
    if (!previous || previous.status === "dropped") {
      changes.push({ taskId, change: next.status === "kept" ? "added" : next.status });
      continue;
    }
    changes.push({ taskId, change: next.status });
  }
  return changes;
}

function describePlan(plan: SolvedPlan, baseline: Placement[], tasks: Task[], disruption: Disruption): { title: string; tradeoff: string } {
  if (!plan.feasible) {
    return {
      title: "No conflict-free schedule",
      tradeoff: plan.conflicts[0]?.message ?? "The constraints cannot all be met.",
    };
  }

  const skip = mechanicalIds(disruption);
  const meaningful = changesAgainst(plan, baseline).filter((change) => change.change !== "kept" && change.change !== "same" && !skip.has(change.taskId));
  if (meaningful.length === 0) {
    return {
      title: "Change only what you reported",
      tradeoff: "Every other task keeps its time. Deadlines and the arrival buffer still hold.",
    };
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const ranked = [...meaningful].sort((a, b) => rankChange(a, taskById) - rankChange(b, taskById));
  const picked = ranked[0];
  const task = taskById.get(picked.taskId);
  const placement = livePlacement(plan, picked.taskId);
  if (!task || !placement) {
    return { title: "Recovery", tradeoff: "This schedule satisfies the hard constraints." };
  }

  if (placement.status === "dropped") {
    return {
      title: `Drop ${task.title.toLowerCase()}`,
      tradeoff: `${task.title} comes off the plan. It is optional, and removing it avoids a later shuffle.`,
    };
  }
  if (placement.status === "shortened") {
    const minutes = placement.endMin - placement.startMin;
    return {
      title: `Shorten ${task.title.toLowerCase()} to ${minutes} min`,
      tradeoff: placement.note,
    };
  }
  if (placement.status === "added") {
    return { title: `Add ${task.title.toLowerCase()}`, tradeoff: placement.note };
  }
  return {
    title: `Move ${task.title.toLowerCase()} to ${formatClock(placement.startMin)}`,
    tradeoff: placement.note,
  };
}

function rankChange(change: Change, tasks: Map<string, Task>): number {
  const task = tasks.get(change.taskId);
  if (task?.flexibility === "protected") return 0;
  if (change.change === "shortened") return 1;
  if (change.change === "dropped") return 2;
  return 10 + (task ? PRIORITY_RANK[task.priority] : 9);
}

function disambiguate(plans: SolvedPlan[], tasks: Task[]): void {
  const counts = new Map<string, number>();
  for (const plan of plans) counts.set(plan.title, (counts.get(plan.title) ?? 0) + 1);
  if ([...counts.values()].every((count) => count === 1)) return;

  const preference = tasks.find((task) => task.preferEndMin != null && task.preferStartMin != null);
  if (!preference) return;
  const times = new Set(
    plans.map((plan) => {
      const placement = livePlacement(plan, preference.id);
      return placement && placement.status !== "dropped" ? placement.startMin : "missing";
    }),
  );
  if (times.size < 2) return;

  for (const plan of plans) {
    const placement = livePlacement(plan, preference.id);
    if (!placement || placement.status === "dropped") {
      plan.title = `Drop ${preference.title.toLowerCase()}`;
      plan.tradeoff = `${preference.title} does not fit this recovery.`;
      continue;
    }
    const misses = preference.preferEndMin != null && placement.endMin > preference.preferEndMin;
    plan.title = misses
      ? `Move ${preference.title.toLowerCase()} to ${formatClock(placement.startMin)}`
      : `Keep ${preference.title.toLowerCase()} at ${formatClock(placement.startMin)}`;
    plan.tradeoff = misses
      ? `${preference.title} leaves its preferred window so higher-priority work stays earlier. ${placement.note}`
      : `${preference.title} stays inside its preferred window. Other tasks move around the new commitment.`;
  }
}

function focusChange(
  plan: SolvedPlan,
  baseline: Placement[],
  tasks: Task[],
  disruption: Disruption,
): { task: Task; placement: Placement } | null {
  const skip = mechanicalIds(disruption);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const changed = changesAgainst(plan, baseline).filter((change) => change.change !== "kept" && change.change !== "same");
  const meaningful = changed.filter((change) => !skip.has(change.taskId));
  const ranked = (meaningful.length > 0 ? meaningful : changed).sort(
    (a, b) => rankChange(a, taskById) - rankChange(b, taskById),
  );
  const picked = ranked[0];
  if (!picked) return null;
  const task = taskById.get(picked.taskId);
  const placement = livePlacement(plan, picked.taskId);
  if (!task || !placement) return null;
  return { task, placement };
}

function plainBlockedReason(strict: SolvedPlan | undefined, tasks: Task[]): string | null {
  if (!strict || strict.feasible) return null;
  const overlap = strict.conflicts.find((conflict) => conflict.id.startsWith("overlap:"));
  if (overlap) {
    const involved = overlap.taskIds
      .map((id) => tasks.find((task) => task.id === id))
      .filter((task): task is Task => Boolean(task));
    const fixed = involved.find((task) => task.flexibility === "fixed");
    const other = involved.find((task) => task !== fixed);
    if (fixed && other) {
      return `Your original ${other.title} overlaps with the new ${fixed.title} time. The options below are recoveries that do fit.`;
    }
  }
  return strict.conflicts[0]?.message ?? "This change does not fit the current commitments.";
}

function narrate(
  disruption: Disruption,
  alternatives: SolvedPlan[],
  tasks: Task[],
  baseline: Placement[],
  blockedReason: string | null,
): { headline: string; detail: string } {
  const recommended = alternatives[0];
  const focus = recommended ? focusChange(recommended, baseline, tasks, disruption) : null;
  let headline = "This change does not fit the day.";
  if (recommended?.feasible && focus) {
    const minutes = focus.placement.endMin - focus.placement.startMin;
    if (focus.task.flexibility === "protected" && focus.placement.status === "moved") {
      headline = `ADAPT recommends moving ${focus.task.title} to ${formatClock(focus.placement.startMin)} because this preserves its full ${minutes}-minute duration.`;
    } else if (focus.placement.status === "shortened") {
      headline = `ADAPT recommends shortening ${focus.task.title} to ${minutes} minutes so it does not overlap the new time.`;
    } else if (focus.placement.status === "dropped") {
      headline = `ADAPT recommends dropping ${focus.task.title} because it is optional and no longer fits cleanly.`;
    } else if (disruption.type === "extend-travel" && focus.task.id === disruption.taskId) {
      headline = "ADAPT recommends shifting departure so you still arrive on time.";
    } else if (focus.placement.status === "moved") {
      headline = `ADAPT recommends moving ${focus.task.title} to ${formatClock(focus.placement.startMin)} so the rest of the day still fits.`;
    } else {
      headline = `ADAPT recommends ${recommended.title}.`;
    }
  } else if (recommended?.feasible) {
    headline = `ADAPT recommends ${recommended.title}.`;
  }

  const lines = [disruption.label];
  if (disruption.type === "extend-travel" || disruption.type === "move-fixed") {
    const note = recommended ? livePlacement(recommended, disruption.taskId)?.note : undefined;
    if (note) lines.push(note);
  }
  if (blockedReason) lines.push(blockedReason);
  if (alternatives.length > 1) {
    lines.push(`There are ${alternatives.length} recoveries. Compare them on the schedule, then approve one or reject them all.`);
  } else if (recommended?.feasible) {
    lines.push("One recovery keeps the deadlines, the arrival buffer, and the fixed times.");
  } else {
    lines.push("No alternative removes the conflict. Reject this change and the accepted plan stays as it is.");
  }
  lines.push("Nothing is saved until you approve.");
  return { headline, detail: lines.join(" ") };
}

/** Build the opening schedule. Every placed block is marked "kept". */
export function solveBaseline(tasks: Task[]): SolvedPlan {
  const plan = solve(tasks, STRATEGIES[0], [], null);
  return {
    ...plan,
    id: "accepted",
    title: "Accepted plan",
    tradeoff: "Sample day before any disruption.",
  };
}

export function propose(tasks: Task[], disruption: Disruption, baseline: Placement[]): ProposalResult {
  const applied = applyDisruption(tasks, disruption);
  if (!applied.ok) return applied;

  const solved = STRATEGIES.map((strategy) => solve(applied.tasks, strategy, baseline, disruption));
  const unique: SolvedPlan[] = [];
  const seen = new Set<string>();
  for (const plan of solved) {
    const key = `${plan.feasible ? "ok" : "bad"}:${signature(plan)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(plan);
  }

  const feasible = unique.filter((plan) => plan.feasible).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const alternatives = (feasible.length > 0 ? feasible : unique).slice(0, 3).map((plan) => ({
    ...plan,
    ...describePlan(plan, baseline, applied.tasks, disruption),
  }));
  disambiguate(alternatives, applied.tasks);

  const strict = solved.find((plan) => plan.id === "earliest");
  const blockedReason = plainBlockedReason(strict, applied.tasks);
  const speech = narrate(disruption, alternatives, applied.tasks, baseline, blockedReason);

  const proposal: Proposal = {
    disruption,
    tasks: applied.tasks,
    alternatives,
    recommendedId: alternatives[0]?.id ?? "earliest",
    blockedReason,
    headline: speech.headline,
    detail: speech.detail,
  };
  return { ok: true, proposal };
}

/** After approval, pin protected and fixed tasks at the times the user accepted. */
export function commitTasks(tasks: Task[], plan: SolvedPlan): Task[] {
  const next: Task[] = [];
  for (const task of tasks) {
    const placement = plan.placements.find((item) => item.taskId === task.id);
    if (!placement || placement.status === "dropped" || placement.status === "unresolved") {
      if (task.optional) continue;
      next.push(cloneTask(task));
      continue;
    }
    const durationMin = placement.endMin - placement.startMin;
    if (task.flexibility === "fixed" || task.flexibility === "protected") {
      next.push({ ...cloneTask(task), durationMin, pinnedStartMin: placement.startMin });
      continue;
    }
    next.push({ ...cloneTask(task), durationMin });
  }
  return next;
}

export function placementsOverlap(plan: SolvedPlan): boolean {
  const live = plan.placements.filter((placement) => placement.status !== "dropped" && placement.status !== "unresolved");
  for (let index = 0; index < live.length; index += 1) {
    for (let inner = index + 1; inner < live.length; inner += 1) {
      if (overlaps(live[index].startMin, live[index].endMin, live[inner].startMin, live[inner].endMin)) return true;
    }
  }
  return false;
}
