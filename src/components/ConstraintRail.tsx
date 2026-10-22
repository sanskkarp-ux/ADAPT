import { DEMO_DISCLAIMER } from "@/lib/demo-data";
import { DEMO_CLOCK_LABEL, durationLabel, formatRange, formatWhen } from "@/lib/time";
import type { Task } from "@/lib/types";

export function ConstraintRail({ tasks }: { tasks: Task[] }) {
  const fixed = tasks.filter((task) => task.flexibility === "fixed" || task.flexibility === "protected");
  const deadlines = tasks.filter((task) => task.deadlineMin != null && task.flexibility !== "protected");
  const travel = tasks.find((task) => task.category === "travel");
  const movable = tasks.filter((task) => task.flexibility === "movable" && task.category !== "travel");

  return (
    <aside className="h-full border-t border-line px-4 py-5 lg:overflow-y-auto lg:border-r lg:border-t-0 lg:px-5">
      <h2 className="text-sm font-semibold text-ink">Accepted constraints</h2>
      <p className="mt-2 text-sm leading-6 text-mute">
        These rules describe the saved plan. A proposal on the schedule does not change them until you approve.
      </p>
      <p className="mt-5 text-sm text-mute">Demo clock</p>
      <p className="mt-1 font-display text-2xl leading-tight">{DEMO_CLOCK_LABEL}</p>
      <p className="mt-4 text-sm leading-6 text-mute">{DEMO_DISCLAIMER}</p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink">Held unless you approve a change</h2>
        <ul className="mt-3 space-y-3">
          {fixed.map((task) => (
            <li key={task.id} className="border-l-2 border-sand pl-3">
              <p className="text-sm text-ink">{task.title}</p>
              <p className="text-sm text-mute">
                {task.flexibility === "fixed" ? "Fixed" : "Protected"}
                {task.pinnedStartMin != null
                  ? ` · ${formatRange(task.pinnedStartMin, task.pinnedStartMin + task.durationMin)}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink">Deadlines and travel</h2>
        <ul className="mt-3 space-y-3 text-sm leading-6 text-mute">
          {deadlines.map((task) => (
            <li key={task.id}>
              {task.title} must finish by {formatWhen(task.deadlineMin ?? task.earliestStartMin)}.
            </li>
          ))}
          {travel ? (
            <li>
              {travel.title} is {durationLabel(travel.durationMin)} plus a {travel.arrivalBufferMin}-minute arrival
              buffer. This is sample travel, not live traffic.
            </li>
          ) : null}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink">Free to reschedule</h2>
        <p className="mt-3 text-sm leading-6 text-mute">{movable.map((task) => task.title).join(", ")}.</p>
      </section>

      <section className="mt-8 border-t border-line pt-5 text-sm leading-6 text-mute">
        <p>Fixed times change only when you report a new time.</p>
        <p className="mt-2">Protected times stay put unless you approve an option that moves them.</p>
        <p className="mt-2">Optional tasks can leave the plan when the morning or evening gets tight.</p>
      </section>
    </aside>
  );
}
