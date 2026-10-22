import { DEMO_REVISION } from "@/lib/demo-data";
import type { Placement, SessionState, Task } from "@/lib/types";

const STORAGE_KEY = "adapt.demo.v1";

interface Envelope {
  version: 1;
  demoRevision: number;
  state: SessionState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlacement(value: unknown): value is Placement {
  if (!isRecord(value)) return false;
  return (
    typeof value.taskId === "string" &&
    typeof value.startMin === "number" &&
    typeof value.endMin === "number" &&
    typeof value.status === "string" &&
    typeof value.note === "string"
  );
}

function isMessage(value: unknown): boolean {
  return isRecord(value) && typeof value.text === "string" && (value.role === "user" || value.role === "adapt");
}

function isTask(value: unknown): value is Task {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.durationMin === "number" &&
    typeof value.earliestStartMin === "number" &&
    Array.isArray(value.dependsOn)
  );
}

export function isSessionState(value: unknown): value is SessionState {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.tasks) || value.tasks.length === 0 || !value.tasks.every(isTask)) return false;
  if (!isRecord(value.accepted) || !Array.isArray(value.accepted.placements)) return false;
  if (!value.accepted.placements.every(isPlacement)) return false;
  if (!Array.isArray(value.openingPlacements) || !value.openingPlacements.every(isPlacement)) return false;
  if (!Array.isArray(value.messages) || !value.messages.every(isMessage) || !Array.isArray(value.appliedLabels)) return false;
  if (typeof value.seq !== "number") return false;
  if (!isRecord(value.status) || typeof value.status.kind !== "string") return false;
  if (value.proposal != null && (!isRecord(value.proposal) || !Array.isArray(value.proposal.alternatives))) return false;
  if (value.selectedAlternativeId != null && typeof value.selectedAlternativeId !== "string") return false;
  const ids = value.tasks.map((task) => (task as Task).id);
  if (new Set(ids).size !== ids.length) return false;
  return true;
}

export type LoadResult = { ok: true; state: SessionState } | { ok: false; reason: "empty" | "invalid" };

export function loadSession(): LoadResult {
  if (typeof window === "undefined") return { ok: false, reason: "empty" };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ok: false, reason: "empty" };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || parsed.demoRevision !== DEMO_REVISION) {
      return { ok: false, reason: "invalid" };
    }
    if (!isSessionState(parsed.state)) return { ok: false, reason: "invalid" };
    const state = parsed.state;
    if (state.status.kind === "loading") state.status = { kind: "idle" };
    return { ok: true, state };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function saveSession(state: SessionState): void {
  if (typeof window === "undefined") return;
  const stored: SessionState =
    state.status.kind === "loading" ? { ...state, status: { kind: "idle" } } : state;
  const envelope: Envelope = { version: 1, demoRevision: DEMO_REVISION, state: stored };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
