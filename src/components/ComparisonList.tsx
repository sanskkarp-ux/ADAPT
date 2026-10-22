import { dayIndex, durationLabel, formatRange } from "@/lib/time";
import type { Placement, ScheduleRow } from "@/lib/types";

function spanText(span: { startMin: number; endMin: number } | null, missing: "Not scheduled" | "No open time"): string {
  if (!span) return missing;
  return formatRange(span.startMin, span.endMin);
}

function shiftedSinceStart(opening: Placement[], accepted: Placement[], taskId: string): boolean {
  const before = opening.find((placement) => placement.taskId === taskId);
  const after = accepted.find((placement) => placement.taskId === taskId);
  const beforeLive = before && before.status !== "dropped" && before.status !== "unresolved";
  const afterLive = after && after.status !== "dropped" && after.status !== "unresolved";
  if (!beforeLive && !afterLive) return false;
  if (!beforeLive || !afterLive) return true;
  return before.startMin !== after.startMin || before.endMin !== after.endMin;
}

const CHANGE_LABEL: Record<ScheduleRow["change"], string | null> = {
  same: null,
  moved: "Moved",
  added: "Added",
  removed: "Removed",
  shortened: "Shortened",
  unresolved: "No open time",
};

export function ComparisonList({
  rows,
  showProposed,
  opening,
  accepted,
}: {
  rows: ScheduleRow[];
  showProposed: boolean;
  opening: Placement[];
  accepted: Placement[];
}) {
  let previousDay: number | null = null;

  return (
    <ol className="mt-6 space-y-2" data-testid="comparison-list">
      {rows.map((row) => {
        const anchor = row.after?.startMin ?? row.before?.startMin;
        const day = anchor == null ? null : dayIndex(anchor);
        const showDay = day != null && day !== previousDay;
        if (day != null) previousDay = day;
        const changeLabel = showProposed ? CHANGE_LABEL[row.change] : null;
        const sinceStart = !showProposed && shiftedSinceStart(opening, accepted, row.taskId);
        const durationSource = row.after ?? row.before;
        const duration = durationSource ? durationSource.endMin - durationSource.startMin : null;
        const flagged = showProposed && row.change !== "same";

        return (
          <li key={row.taskId}>
            {showDay ? (
              <h3 className="mb-2 mt-4 font-display text-2xl">{day === 0 ? "Wednesday" : "Thursday"}</h3>
            ) : null}
            <article
              data-testid="task-row"
              data-task-id={row.taskId}
              data-change={showProposed ? row.change : sinceStart ? "since-start" : "same"}
              className={`rounded-xl border px-3 py-3 sm:px-4 ${
                flagged ? "border-cyan/50 bg-cyandim/40" : "border-line bg-panel"
              }`}
            >
              <div className="grid gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-start">
                <div>
                  <h4 className="text-base font-medium">{row.title}</h4>
                  <p className="mt-1 text-sm text-mute">
                    {row.location ? `${row.location}` : row.detail}
                    {duration != null ? ` · ${durationLabel(duration)}` : ""}
                    {row.flexibility === "fixed" ? " · Fixed" : ""}
                    {row.flexibility === "protected" ? " · Protected" : ""}
                    {row.flexibility === "movable" && !row.optional ? " · Free to move" : ""}
                    {row.optional ? " · Optional" : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {changeLabel ? (
                      <span className="rounded-full bg-cyan px-2 py-0.5 text-xs font-semibold text-abyss">{changeLabel}</span>
                    ) : null}
                    {sinceStart ? (
                      <span className="rounded-full border border-sand/50 px-2 py-0.5 text-xs text-sand">
                        Changed from sample start
                      </span>
                    ) : null}
                    {row.conflict ? (
                      <span className="rounded-full bg-amber px-2 py-0.5 text-xs font-semibold text-sandink">Conflict</span>
                    ) : null}
                  </div>
                </div>
                <div>
                  <p className="text-sm text-sand">Accepted</p>
                  <p className="font-display text-lg leading-tight">{spanText(row.before, "Not scheduled")}</p>
                </div>
                <div>
                  <p className="text-sm text-cyan">Proposed</p>
                  <p className="font-display text-lg leading-tight">
                    {showProposed ? spanText(row.after, row.change === "unresolved" ? "No open time" : "Not scheduled") : "Waiting"}
                  </p>
                </div>
              </div>
              {flagged && row.note ? <p className="mt-3 text-sm leading-6 text-ink">{row.note}</p> : null}
            </article>
          </li>
        );
      })}
    </ol>
  );
}
