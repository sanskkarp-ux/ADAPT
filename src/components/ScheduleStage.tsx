import { AlternativeDeck } from "@/components/AlternativeDeck";
import { ComparisonList } from "@/components/ComparisonList";
import { StateBanner } from "@/components/StateBanner";
import { TimelineBands } from "@/components/TimelineBands";
import { buildRows } from "@/lib/schedule-view";
import { formatRange } from "@/lib/time";
import type { AppStatus, Placement, Proposal, ScheduleRow, Task } from "@/lib/types";

function bannerFor(status: AppStatus, proposal: Proposal | null): { kind: "loading" | "success" | "error" | "rejected" | "conflict"; text: string } | null {
  if (status.kind === "loading") {
    return {
      kind: "loading",
      text: "Checking deadlines, travel, sleep, and protected commitments. The accepted plan is unchanged.",
    };
  }
  if (status.kind === "error") return { kind: "error", text: status.text };
  if (status.kind === "success") return { kind: "success", text: status.text };
  if (status.kind === "rejected") return { kind: "rejected", text: status.text };
  if (proposal?.blockedReason) return { kind: "conflict", text: proposal.blockedReason };
  return null;
}

export function ScheduleStage({
  tasks,
  accepted,
  opening,
  proposal,
  selectedPlanId,
  status,
  appliedLabels,
  onSelect,
  onApprove,
  onReject,
}: {
  tasks: Task[];
  accepted: Placement[];
  opening: Placement[];
  proposal: Proposal | null;
  selectedPlanId: string | null;
  status: AppStatus;
  appliedLabels: string[];
  onSelect: (id: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const selected = proposal?.alternatives.find((plan) => plan.id === selectedPlanId) ?? null;
  const rows: ScheduleRow[] = buildRows(tasks, accepted, selected?.placements ?? null, selected?.conflicts ?? []);
  const sleep = rows.find((row) => row.taskId === "sleep");
  const sleepSpan = sleep?.before;
  const sleepLabel = sleepSpan ? formatRange(sleepSpan.startMin, sleepSpan.endMin) : "Protected rest";
  const banner = bannerFor(status, proposal);
  const sinceStart = rows.filter((row) => {
    const before = opening.find((placement) => placement.taskId === row.taskId);
    const after = accepted.find((placement) => placement.taskId === row.taskId);
    if (!before || !after) return Boolean(before) !== Boolean(after);
    return before.startMin !== after.startMin || before.endMin !== after.endMin || before.status !== after.status;
  }).length;
  const approveDisabled = !selected || !selected.feasible;

  return (
    <section id="schedule" aria-busy={status.kind === "loading"} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="max-w-3xl">
          <h1 className="text-balance font-display text-3xl leading-tight sm:text-5xl">The day, before and after</h1>
          <p className="mt-3 text-base leading-7 text-mute">
            Sand is the accepted plan. Cyan is a proposed recovery. ADAPT does not replace the accepted plan until you
            approve.
          </p>
        </div>

        {banner ? <StateBanner kind={banner.kind} text={banner.text} /> : null}

        {appliedLabels.length > 0 ? (
          <div className="rounded-2xl border border-line bg-panel px-4 py-3">
            <p className="text-sm font-semibold">Already approved in this demo</p>
            <ul className="mt-2 space-y-1 text-sm leading-6 text-mute">
              {appliedLabels.map((label, index) => (
                <li key={`${index}-${label}`}>{label}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {!proposal && sinceStart > 0 ? (
          <p className="text-sm text-sand">
            {sinceStart} {sinceStart === 1 ? "task differs" : "tasks differ"} from the original sample schedule.
          </p>
        ) : null}

        <TimelineBands rows={rows} showProposed={Boolean(selected)} sleepLabel={sleepLabel} />

        {proposal ? (
          <AlternativeDeck
            plans={proposal.alternatives}
            recommendedId={proposal.recommendedId}
            selectedId={selectedPlanId}
            onSelect={onSelect}
          />
        ) : (
          <AlternativeDeck plans={[]} recommendedId="" selectedId={null} onSelect={onSelect} />
        )}

        {proposal && selected ? (
          <div className="rounded-2xl border border-line bg-panel px-4 py-4">
            <p className="text-sm font-semibold text-cyan" data-testid="why-panel">
              Why this recovery
            </p>
            {proposal.understood ? <p className="mt-2 text-sm leading-6 text-ink">Understood: {proposal.understood}</p> : null}
            <p className="mt-2 text-sm leading-6 text-ink">{selected.tradeoff}</p>
            {proposal.channel === "mcp" ? (
              <p className="mt-2 text-sm leading-6 text-mute">
                Calculated by the local planning tool. This tool speaks MCP. It is not an Alexa device.
              </p>
            ) : null}
            {proposal.channel === "builtin" ? (
              <p className="mt-2 text-sm leading-6 text-amber">
                The planning tool was unavailable, so the built-in demo scheduler calculated this.
              </p>
            ) : null}
            <p className="mt-3 text-sm text-mute">Ready to keep: {selected.title}</p>
            {approveDisabled ? (
              <p className="mt-1 text-sm text-amber">This option still has a conflict, so it cannot be approved.</p>
            ) : (
              <p className="mt-1 text-sm text-mute">Reject leaves the accepted plan exactly as it is.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                data-testid="reject"
                onClick={onReject}
                className="rounded-full border border-line px-5 py-3 text-sm font-medium text-ink hover:border-bad hover:text-bad"
              >
                Reject
              </button>
              <button
                type="button"
                data-testid="approve"
                onClick={onApprove}
                disabled={approveDisabled}
                className="rounded-full bg-cyan px-5 py-3 text-sm font-semibold text-abyss disabled:cursor-not-allowed disabled:opacity-40"
              >
                Approve changes
              </button>
            </div>
          </div>
        ) : null}

        <ComparisonList rows={rows} showProposed={Boolean(selected)} opening={opening} accepted={accepted} />
      </div>
    </section>
  );
}
