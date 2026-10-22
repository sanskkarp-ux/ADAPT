import { describe, expect, it } from "vitest";
import { makeDisruption } from "@/lib/demo-data";
import { propose } from "@/lib/planner";
import { createInitialSession, reducer } from "@/lib/session";
import { at } from "@/lib/time";

describe("session transitions", () => {
  it("starts from a feasible sample day", () => {
    const state = createInitialSession();
    expect(state.accepted.feasible).toBe(true);
    expect(state.proposal).toBeNull();
    expect(state.messages[0]?.text.toLowerCase()).toContain("sample");
  });

  it("does not apply a proposal until approve", () => {
    const start = createInitialSession();
    const disruption = makeDisruption("presentation", start.tasks);
    if (!disruption.ok) throw new Error(disruption.error);
    const result = propose(start.tasks, disruption.disruption, start.accepted.placements);
    if (!result.ok) throw new Error(result.error);

    const loading = reducer(start, { type: "LOADING", userText: "The presentation moved to 11." });
    expect(loading.proposal).toBeNull();
    expect(loading.tasks.find((task) => task.id === "present")?.pinnedStartMin).toBe(at(1, 9, 0));

    const proposed = reducer(loading, { type: "ENGINE_RESULT", proposal: result.proposal });
    expect(proposed.proposal).not.toBeNull();
    expect(proposed.tasks.find((task) => task.id === "present")?.pinnedStartMin).toBe(at(1, 9, 0));
    expect(proposed.selectedAlternativeId).toBe(result.proposal.recommendedId);

    const blocked = reducer(proposed, { type: "LOADING", userText: "Traffic adds 30 minutes." });
    expect(blocked.proposal).not.toBeNull();
    expect(blocked.status.kind).toBe("error");

    const other = result.proposal.alternatives.find((plan) => plan.id !== result.proposal.recommendedId)!;
    const selected = reducer(proposed, { type: "SELECT", id: other.id });
    const approved = reducer(selected, { type: "APPROVE" });
    expect(approved.proposal).toBeNull();
    expect(approved.status.kind).toBe("success");
    expect(approved.accepted.id).toBe("accepted");
    expect(approved.tasks.find((task) => task.id === "present")?.pinnedStartMin).toBe(at(1, 11, 0));
    const seminar = approved.accepted.placements.find((placement) => placement.taskId === "seminar");
    const chosenSeminar = other.placements.find((placement) => placement.taskId === "seminar");
    expect(seminar?.startMin).toBe(chosenSeminar?.startMin);
  });

  it("reject leaves the accepted plan alone", () => {
    const start = createInitialSession();
    const disruption = makeDisruption("traffic", start.tasks);
    if (!disruption.ok) throw new Error(disruption.error);
    const result = propose(start.tasks, disruption.disruption, start.accepted.placements);
    if (!result.ok) throw new Error(result.error);
    const loading = reducer(start, { type: "LOADING", userText: "Traffic adds 30 minutes." });
    const proposed = reducer(loading, { type: "ENGINE_RESULT", proposal: result.proposal });
    const rejected = reducer(proposed, { type: "REJECT" });
    expect(rejected.proposal).toBeNull();
    expect(rejected.status.kind).toBe("rejected");
    expect(rejected.tasks.find((task) => task.id === "commute")?.durationMin).toBe(45);
  });

  it("refuses approval when nothing is pending and refuses an infeasible plan", () => {
    const start = createInitialSession();
    const denied = reducer(start, { type: "APPROVE" });
    expect(denied.status.kind).toBe("error");
    expect(denied.accepted.placements).toEqual(start.accepted.placements);

    const broken = reducer(start, { type: "LOADING", userText: "Break it." });
    const proposal = propose(
      start.tasks,
      { type: "extend-travel", taskId: "commute", addMin: 30, label: "Traffic." },
      start.accepted.placements,
    );
    if (!proposal.ok) throw new Error(proposal.error);
    const infeasible = {
      ...proposal.proposal.alternatives[0],
      id: "bad",
      feasible: false,
    };
    const pending = reducer(broken, {
      type: "ENGINE_RESULT",
      proposal: { ...proposal.proposal, alternatives: [infeasible], recommendedId: "bad" },
    });
    const refused = reducer(pending, { type: "APPROVE" });
    expect(refused.status.kind).toBe("error");
    expect(refused.proposal).not.toBeNull();
    expect(refused.tasks.find((task) => task.id === "commute")?.durationMin).toBe(45);
  });

  it("resets back to the 9:00 AM presentation", () => {
    const start = createInitialSession();
    const reset = reducer(start, { type: "RESET" });
    expect(reset.tasks.find((task) => task.id === "present")?.pinnedStartMin).toBe(at(1, 9, 0));
    expect(reset.proposal).toBeNull();
    expect(reset.appliedLabels).toEqual([]);
    expect(reset.messages.some((message) => /restored/i.test(message.text))).toBe(true);
  });
});
