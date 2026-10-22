import type { SolvedPlan } from "@/lib/types";

export function AlternativeDeck({
  plans,
  recommendedId,
  selectedId,
  onSelect,
}: {
  plans: SolvedPlan[];
  recommendedId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (plans.length === 0) {
    return (
      <div data-testid="empty-recovery" className="rounded-2xl border border-dashed border-line px-4 py-6">
        <p className="text-sm font-semibold">Nothing to review</p>
        <p className="mt-2 text-sm leading-6 text-mute">
          No recovery is waiting. The accepted schedule is the plan ADAPT will keep. Use a sample disruption when the
          day changes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-display text-2xl">Ways to recover</h3>
      {plans.map((plan, index) => {
        const selected = plan.id === selectedId;
        return (
          <button
            key={plan.id}
            type="button"
            data-testid="alternative-card"
            data-plan-id={plan.id}
            data-recommended={plan.id === recommendedId ? "true" : "false"}
            aria-pressed={selected}
            onClick={() => onSelect(plan.id)}
            className={`w-full rounded-2xl border px-4 py-4 text-left ${
              selected ? "border-cyan bg-cyandim/50" : "border-line bg-panel hover:border-mute"
            }`}
          >
            <p className="text-sm text-mute">
              Option {index + 1}
              {plan.id === recommendedId ? " · Recommended" : ""}
              {selected ? " · Selected" : ""}
              {!plan.feasible ? " · Still conflicting" : ""}
            </p>
            <p className="mt-1 text-lg font-medium">{plan.title}</p>
            <p className="mt-2 text-sm leading-6 text-ink">{plan.tradeoff}</p>
          </button>
        );
      })}
    </div>
  );
}
