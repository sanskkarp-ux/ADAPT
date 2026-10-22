import { describe, expect, it } from "vitest";
import { demoTasks, makeDisruption } from "@/lib/demo-data";
import { demoCalendar, demoInterpreter, demoTraffic, disruptionFromTraffic } from "@/lib/providers";
import { placementsOverlap, propose, solveBaseline } from "@/lib/planner";
import { createInitialSession, reducer } from "@/lib/session";
import { at } from "@/lib/time";
import type { Placement, SolvedPlan, Task } from "@/lib/types";

function task(partial: Pick<Task, "id" | "title"> & Partial<Task>): Task {
  return {
    detail: "Rule check. Not live data.",
    durationMin: 60,
    priority: "high",
    flexibility: "movable",
    category: "focus",
    earliestStartMin: at(0, 16, 0),
    latestEndMin: null,
    deadlineMin: null,
    pinnedStartMin: null,
    dependsOn: [],
    ...partial,
  };
}

function byId(plan: SolvedPlan, taskId: string): Placement {
  const placement = plan.placements.find((item) => item.taskId === taskId);
  if (!placement) throw new Error(`Missing ${taskId}`);
  return placement;
}

describe("deadline, fixed, and protected rules", () => {
  it("marks a deadline violation instead of scheduling past it", () => {
    const plan = solveBaseline([
      task({
        id: "essay",
        title: "History essay",
        durationMin: 120,
        priority: "critical",
        earliestStartMin: at(0, 16, 0),
        latestEndMin: at(0, 17, 0),
        deadlineMin: at(0, 17, 0),
      }),
    ]);
    expect(plan.feasible).toBe(false);
    expect(plan.conflicts.some((conflict) => /deadline/i.test(conflict.message))).toBe(true);
    expect(placementsOverlap(plan)).toBe(false);
  });

  it("keeps a fixed appointment unless the disruption names that appointment", () => {
    const tasks = [
      task({
        id: "present",
        title: "Studio presentation",
        flexibility: "fixed",
        category: "commitment",
        earliestStartMin: at(1, 8, 0),
        latestEndMin: at(1, 15, 0),
        pinnedStartMin: at(1, 9, 0),
        onCampus: true,
      }),
      task({
        id: "commute",
        title: "Commute to campus",
        durationMin: 45,
        priority: "critical",
        category: "travel",
        earliestStartMin: at(1, 6, 30),
        arrivesBeforeTaskId: "present",
        arrivalBufferMin: 15,
      }),
    ];
    const baseline = solveBaseline(tasks);
    expect(byId(baseline, "present").startMin).toBe(at(1, 9, 0));

    const result = propose(
      tasks,
      {
        type: "extend-travel",
        taskId: "commute",
        addMin: 30,
        label: "Traffic increased the commute.",
      },
      baseline.placements,
    );
    if (!result.ok) throw new Error(result.error);
    const plan = result.proposal.alternatives[0];
    expect(plan.feasible).toBe(true);
    expect(byId(plan, "present").startMin).toBe(at(1, 9, 0));
    expect(byId(plan, "commute").endMin - byId(plan, "commute").startMin).toBe(75);
    expect(byId(plan, "present").startMin - byId(plan, "commute").endMin).toBe(15);
    expect(byId(plan, "present").note.toLowerCase()).not.toMatch(/moved to/);
  });

  it("moves a protected task only in an alternative, and explains the overlap", () => {
    const tasks = [
      task({
        id: "present",
        title: "Studio presentation",
        flexibility: "fixed",
        category: "commitment",
        earliestStartMin: at(1, 8, 0),
        latestEndMin: at(1, 15, 0),
        pinnedStartMin: at(1, 9, 0),
        onCampus: true,
      }),
      task({
        id: "seminar",
        title: "Required seminar",
        flexibility: "protected",
        category: "commitment",
        earliestStartMin: at(1, 8, 0),
        latestEndMin: at(1, 15, 0),
        pinnedStartMin: at(1, 10, 15),
        onCampus: true,
      }),
    ];
    const baseline = solveBaseline(tasks);
    expect(byId(baseline, "seminar").startMin).toBe(at(1, 10, 15));
    const result = propose(
      tasks,
      {
        type: "move-fixed",
        taskId: "present",
        newStartMin: at(1, 11, 0),
        label: "Presentation moved to 11:00 AM.",
      },
      baseline.placements,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.proposal.blockedReason?.toLowerCase()).toContain("overlaps");
    const full = result.proposal.alternatives.find((plan) => byId(plan, "seminar").endMin - byId(plan, "seminar").startMin === 60);
    const short = result.proposal.alternatives.find((plan) => byId(plan, "seminar").endMin - byId(plan, "seminar").startMin === 45);
    expect(full?.feasible).toBe(true);
    expect(byId(full!, "seminar").startMin).toBe(at(1, 12, 0));
    expect(byId(full!, "present").startMin).toBe(at(1, 11, 0));
    expect(short?.feasible).toBe(true);
    expect(result.proposal.headline).toMatch(/preserves its full 60-minute duration/);
  });
});

describe("demo explanations and provider boundary", () => {
  it("states the presentation conflict, the seminar recommendation, and the traffic change", () => {
    const tasks = demoTasks();
    const baseline = solveBaseline(tasks);
    const presentation = makeDisruption("presentation", tasks);
    if (!presentation.ok) throw new Error(presentation.error);
    const proposed = propose(tasks, presentation.disruption, baseline.placements);
    if (!proposed.ok) throw new Error(proposed.error);
    expect(proposed.proposal.blockedReason).toMatch(/Required seminar overlaps with the new Studio presentation/i);
    expect(proposed.proposal.headline).toMatch(/moving Required seminar to 12:00 PM/);
    expect(byId(proposed.proposal.alternatives.find((plan) => plan.id === proposed.proposal.recommendedId)!, "present").note).toBe(
      "Studio presentation moved to 11:00 AM.",
    );

    const traffic = makeDisruption("traffic", tasks);
    if (!traffic.ok) throw new Error(traffic.error);
    const delayed = propose(tasks, traffic.disruption, baseline.placements);
    if (!delayed.ok) throw new Error(delayed.error);
    const commute = byId(delayed.proposal.alternatives[0], "commute").note;
    expect(commute).toContain("Traffic increased Commute to campus from 45 to 75 minutes.");
    expect(commute).toContain("To arrive 15 minutes before Studio presentation, departure moves from 8:00 AM to 7:30 AM.");
  });

  it("keeps demo providers disconnected and normalizes traffic into a disruption", () => {
    const snapshot = demoCalendar.load();
    expect(snapshot.connected).toBe(false);
    expect(snapshot.source).toBe("demo");
    expect(snapshot.tasks.some((item) => item.id === "present")).toBe(true);
    expect(demoInterpreter.connected).toBe(false);
    expect(demoInterpreter.interpret("approve").command).toEqual({ type: "approve" });
    const delay = demoTraffic.sampleDelay(snapshot.tasks);
    expect(delay?.connected).toBe(false);
    expect(delay?.addedMinutes).toBe(30);
    expect(disruptionFromTraffic(delay!).type).toBe("extend-travel");
    expect(demoTraffic.sampleDelay(snapshot.tasks.map((item) => (item.id === "commute" ? { ...item, durationMin: 75 } : item)))).toBeNull();
  });
});

describe("approval, rejection, and reset", () => {
  it("approval writes the selected plan, rejection and reset do not", () => {
    const start = createInitialSession();
    const presentation = makeDisruption("presentation", start.tasks);
    if (!presentation.ok) throw new Error(presentation.error);
    const result = propose(start.tasks, presentation.disruption, start.accepted.placements);
    if (!result.ok) throw new Error(result.error);
    const pending = reducer(reducer(start, { type: "LOADING", userText: "Presentation moved to 11:00 AM." }), {
      type: "ENGINE_RESULT",
      proposal: result.proposal,
    });

    const rejected = reducer(pending, { type: "REJECT" });
    expect(rejected.status.kind).toBe("rejected");
    expect(rejected.tasks.find((item) => item.id === "present")?.pinnedStartMin).toBe(at(1, 9, 0));

    const approved = reducer(pending, { type: "APPROVE" });
    expect(approved.status.kind).toBe("success");
    expect(approved.proposal).toBeNull();
    expect(approved.tasks.find((item) => item.id === "present")?.pinnedStartMin).toBe(at(1, 11, 0));

    const reset = reducer(approved, { type: "RESET" });
    expect(reset.tasks.find((item) => item.id === "present")?.pinnedStartMin).toBe(at(1, 9, 0));
    expect(reset.appliedLabels).toEqual([]);
    expect(reset.proposal).toBeNull();
  });
});
