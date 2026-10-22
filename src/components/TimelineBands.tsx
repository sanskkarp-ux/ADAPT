import { rowsInBand, TONIGHT, TOMORROW, type Band } from "@/lib/schedule-view";
import type { ScheduleRow } from "@/lib/types";

function percent(minute: number, band: Band): number {
  return ((minute - band.startMin) / (band.endMin - band.startMin)) * 100;
}

function bandRows(rows: ScheduleRow[], band: Band): ScheduleRow[] {
  const ids = new Set([
    ...rowsInBand(rows, band, "before").map((row) => row.taskId),
    ...rowsInBand(rows, band, "after").map((row) => row.taskId),
  ]);
  return rows
    .filter((row) => ids.has(row.taskId))
    .sort((a, b) => {
      const aStart = a.before?.startMin ?? a.after?.startMin ?? 0;
      const bStart = b.before?.startMin ?? b.after?.startMin ?? 0;
      return aStart - bStart || a.title.localeCompare(b.title);
    });
}

function Bar({
  start,
  end,
  band,
  tone,
  stacked,
}: {
  start: number;
  end: number;
  band: Band;
  tone: "accepted" | "proposed";
  stacked: boolean;
}) {
  const visibleStart = Math.max(start, band.startMin);
  const visibleEnd = Math.min(end, band.endMin);
  if (visibleEnd <= visibleStart) return null;
  const left = percent(visibleStart, band);
  const width = percent(visibleEnd, band) - left;
  const place = !stacked ? "top-1/2 h-3.5 -translate-y-1/2" : tone === "proposed" ? "bottom-1 h-3" : "top-1 h-3";
  return (
    <span
      className={`absolute rounded-full ${place} ${tone === "proposed" ? "bg-cyan" : "bg-sand"}`}
      style={{ left: `${left}%`, width: `${Math.max(width, 1.4)}%` }}
    />
  );
}

function TaskLane({ row, band, showProposed }: { row: ScheduleRow; band: Band; showProposed: boolean }) {
  const changed = showProposed && row.change !== "same";
  const proposedDiffers =
    showProposed &&
    row.after != null &&
    (row.before == null || row.before.startMin !== row.after.startMin || row.before.endMin !== row.after.endMin);

  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
      <p className={`truncate text-sm ${changed ? "text-cyan" : "text-ink"}`} title={row.title}>
        {row.title}
      </p>
      <div className={`relative h-9 rounded-lg ${changed ? "bg-cyandim/40" : "bg-abyss/50"}`}>
        {band.ticks.map((tick) => (
          <span
            key={tick.label}
            className="absolute inset-y-0 w-px bg-line/70"
            style={{ left: `${percent(tick.minute, band)}%` }}
          />
        ))}
        {row.before ? (
          <Bar start={row.before.startMin} end={row.before.endMin} band={band} tone="accepted" stacked={proposedDiffers} />
        ) : null}
        {proposedDiffers && row.after ? (
          <Bar start={row.after.startMin} end={row.after.endMin} band={band} tone="proposed" stacked />
        ) : null}
      </div>
    </div>
  );
}

function BandBlock({ band, rows, showProposed }: { band: Band; rows: ScheduleRow[]; showProposed: boolean }) {
  const visible = bandRows(rows, band);
  return (
    <section>
      <div className="mb-2 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
        <h3 className="self-end text-sm font-semibold">{band.title}</h3>
        <div className="relative h-6">
          {band.ticks.map((tick) => {
            const left = percent(tick.minute, band);
            const shift = left < 8 ? "0%" : left > 92 ? "-100%" : "-50%";
            return (
              <span
                key={tick.label}
                className="absolute top-0 whitespace-nowrap text-sm text-mute"
                style={{ left: `${left}%`, transform: `translateX(${shift})` }}
              >
                {tick.label}
              </span>
            );
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        {visible.map((row) => (
          <TaskLane key={row.taskId} row={row} band={band} showProposed={showProposed} />
        ))}
      </div>
    </section>
  );
}

export function TimelineBands({
  rows,
  showProposed,
  sleepLabel,
}: {
  rows: ScheduleRow[];
  showProposed: boolean;
  sleepLabel: string;
}) {
  return (
    <div className="space-y-5" aria-hidden="true">
      <BandBlock band={TONIGHT} rows={rows} showProposed={showProposed} />
      <div className="rounded-xl border border-line bg-raised/60 px-4 py-3">
        <p className="text-sm text-sand">Sleep, protected</p>
        <p className="text-balance font-display text-xl leading-snug sm:text-2xl">{sleepLabel}</p>
        <p className="mt-1 text-sm text-mute">
          Rest is a bridge so tonight and tomorrow fit together. The time above is the real span.
        </p>
      </div>
      <BandBlock band={TOMORROW} rows={rows} showProposed={showProposed} />
      <p className="text-sm text-mute">Sand is the accepted time. Cyan is the proposed time, drawn only when it differs.</p>
    </div>
  );
}
