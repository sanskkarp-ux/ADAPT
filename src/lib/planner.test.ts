import { describe, expect, it } from "vitest";
import { demoTasks, makeDisruption } from "@/lib/demo-data";
import { commitTasks, placementsOverlap, propose, solveBaseline } from "@/lib/planner";
import { at } from "@/lib/time";
import type { Placement, SolvedPlan, Task } from "@/lib/types";

function byId(plan: SolvedPlan, taskId: string): Placement {
  const placement = plan.placements.find((item) => item.taskId === taskId);
  if (!placement) throw new Error(`Missing placement ${taskId}\n${dump(plan)}`);
  return placement;
}

function dump(plan: SolvedPlan): string {
  return plan.placements
    .map((placement) => `${placement.taskId} ${placement.status} ${placement.startMin}-${placement.endMin}`)
    .join("\n");
}

describe("opening sample day", () => {
  const tasks = demoTasks();
  const plan = solveBaseline(tasks);

  it("is feasible and does not overlap", () => {
    expect(plan.feasible, dump(plan) + "\n" + plan.conflicts.map((conflict) => conflict.message).join("\n")).toBe(true);
    expect(placementsOverlap(plan)).toBe(false);
  });

  it("places the known sample schedule", () => {
    expect(byId(plan, "essay").startMin).toBe(at(0, 16, 0));
    expect(byId(plan, "essay").endMin).toBe(at(0, 18, 0));
    expect(byId(plan, "prep").startMin).toBe(at(0, 18, 0));
    expect(byId(plan, "prep").endMin).toBe(at(0, 19, 30));
    expect(byId(plan, "dinner").startMin).toBe(at(0, 19, 30));
    expect(byId(plan, "dinner").endMin).toBe(at(0, 20, 15));
    expect(byId(plan, "cards").startMin).toBe(at(0, 20, 15));
    expect(byId(plan, "sleep").startMin).toBe(at(0, 23, 0));
    expect(byId(plan, "sleep").endMin).toBe(at(1, 6, 30));
    expect(byId(plan, "routine").startMin).toBe(at(1, 6, 30));
    expect(byId(plan, "print").startMin).toBe(at(1, 7, 0));
    expect(byId(plan, "gym").startMin).toBe(at(1, 7, 20));
    expect(byId(plan, "commute").startMin).toBe(at(1, 8, 0));
    expect(byId(plan, "commute").endMin).toBe(at(1, 8, 45));
    expect(byId(plan, "present").startMin).toBe(at(1, 9, 0));
    expect(byId(plan, "present").endMin).toBe(at(1, 10, 0));
    expect(byId(plan, "seminar").startMin).toBe(at(1, 10, 15));
    expect(byId(plan, "seminar").endMin).toBe(at(1, 11, 15));
    expect(byId(plan, "standup").startMin).toBe(at(1, 11, 15));
    expect(byId(plan, "lunch").startMin).toBe(at(1, 12, 0));
  });

  it("keeps a 15-minute arrival buffer and finishes rehearsal before departure", () => {
    const commute = byId(plan, "commute");
    const present = byId(plan, "present");
    const prep = byId(plan, "prep");
    expect(present.startMin - commute.endMin).toBe(15);
    expect(prep.endMin).toBeLessThanOrEqual(commute.startMin);
  });
});

describe("presentation moves to 11:00 AM", () => {
  const tasks = demoTasks();
  const baseline = solveBaseline(tasks);
  const disruption = makeDisruption("presentation", tasks);
  if (!disruption.ok) throw new Error(disruption.error);
  const result = propose(tasks, disruption.disruption, baseline.placements);
  if (!result.ok) throw new Error(result.error);

  it("explains the strict conflict and offers two feasible recoveries", () => {
    expect(result.proposal.blockedReason).toBeTruthy();
    const feasible = result.proposal.alternatives.filter((plan) => plan.feasible);
    expect(feasible.length).toBeGreaterThanOrEqual(2);
    for (const plan of feasible) expect(placementsOverlap(plan)).toBe(false);
  });

  it("keeps the full seminar in the recommended plan and offers a shorter seminar too", () => {
    const recommended = result.proposal.alternatives.find((plan) => plan.id === result.proposal.recommendedId);
    expect(recommended?.feasible).toBe(true);
    const full = result.proposal.alternatives.find((plan) => {
      const seminar = byId(plan, "seminar");
      return seminar.startMin === at(1, 12, 0) && seminar.endMin - seminar.startMin === 60;
    });
    const shortened = result.proposal.alternatives.find((plan) => {
      const seminar = byId(plan, "seminar");
      return seminar.startMin === at(1, 10, 15) && seminar.endMin - seminar.startMin < 60;
    });
    expect(full, result.proposal.alternatives.map((plan) => plan.title).join(" | ")).toBeTruthy();
    expect(shortened).toBeTruthy();
    expect(byId(recommended!, "seminar").endMin - byId(recommended!, "seminar").startMin).toBe(60);
  });

  it("moves the commute with the presentation and leaves the essay alone", () => {
    const recommended = result.proposal.alternatives[0];
    const present = byId(recommended, "present");
    const commute = byId(recommended, "commute");
    expect(present.startMin).toBe(at(1, 11, 0));
    expect(present.startMin - commute.endMin).toBe(15);
    expect(byId(recommended, "essay").startMin).toBe(at(0, 16, 0));
    const seminarNote = recommended.placements.find((placement) => placement.taskId === "seminar")?.note ?? "";
    expect(seminarNote.toLowerCase()).toContain("overlaps");
    expect(seminarNote).toContain("60");
    expect(result.proposal.headline).toMatch(/ADAPT recommends moving/i);
    expect(result.proposal.headline).toContain("60");
    expect(result.proposal.blockedReason?.toLowerCase()).toContain("overlaps");
    expect(byId(recommended, "present").note).toMatch(/moved to 11:00 AM/i);
  });
});

describe("traffic adds 30 minutes", () => {
  const tasks = demoTasks();
  const baseline = solveBaseline(tasks);
  const disruption = makeDisruption("traffic", tasks);
  if (!disruption.ok) throw new Error(disruption.error);
  const result = propose(tasks, disruption.disruption, baseline.placements);
  if (!result.ok) throw new Error(result.error);

  it("departs earlier and still arrives 15 minutes ahead", () => {
    expect(result.proposal.alternatives.length).toBeGreaterThanOrEqual(2);
    for (const plan of result.proposal.alternatives) {
      expect(plan.feasible).toBe(true);
      expect(placementsOverlap(plan)).toBe(false);
      const commute = byId(plan, "commute");
      const present = byId(plan, "present");
      expect(commute.endMin - commute.startMin).toBe(75);
      expect(present.startMin - commute.endMin).toBe(15);
      expect(present.startMin).toBe(at(1, 9, 0));
    }
  });

  it("explains the longer commute in plain language", () => {
    const note = byId(result.proposal.alternatives[0], "commute").note;
    expect(note).toMatch(/from 45 to 75/);
    expect(note).toMatch(/from 8:00 AM to 7:30 AM/);
    expect(note.toLowerCase()).toContain("15 minutes before");
  });

  it("offers both moving and dropping the optional gym session", () => {
    const moved = result.proposal.alternatives.some((plan) => byId(plan, "gym").status !== "dropped");
    const dropped = result.proposal.alternatives.some((plan) => byId(plan, "gym").status === "dropped");
    expect(moved).toBe(true);
    expect(dropped).toBe(true);
  });
});

describe("pick up Noah", () => {
  const tasks = demoTasks();
  const baseline = solveBaseline(tasks);
  const disruption = makeDisruption("pickup", tasks);
  if (!disruption.ok) throw new Error(disruption.error);
  const result = propose(tasks, disruption.disruption, baseline.placements);
  if (!result.ok) throw new Error(result.error);
  const dinner = tasks.find((task) => task.id === "dinner")!;

  it("offers two feasible evenings and never misses the essay deadline", () => {
    expect(result.proposal.alternatives.length).toBeGreaterThanOrEqual(2);
    for (const plan of result.proposal.alternatives) {
      expect(plan.feasible).toBe(true);
      expect(placementsOverlap(plan)).toBe(false);
      const essay = byId(plan, "essay");
      const prep = byId(plan, "prep");
      const pickup = byId(plan, "pickup");
      const commute = byId(plan, "commute");
      expect(essay.endMin).toBeLessThanOrEqual(at(0, 23, 59));
      expect(prep.endMin).toBeLessThanOrEqual(commute.startMin);
      expect(pickup.endMin).toBeLessThanOrEqual(at(0, 18, 30));
      expect(pickup.startMin).toBeGreaterThanOrEqual(at(0, 17, 0));
    }
  });

  it("lets the user keep dinner or move it", () => {
    const kept = result.proposal.alternatives.some((plan) => byId(plan, "dinner").endMin <= (dinner.preferEndMin ?? 0));
    const moved = result.proposal.alternatives.some((plan) => byId(plan, "dinner").endMin > (dinner.preferEndMin ?? 0));
    expect(kept).toBe(true);
    expect(moved).toBe(true);
    const recommended = result.proposal.alternatives.find((plan) => plan.id === result.proposal.recommendedId)!;
    expect(byId(recommended, "dinner").endMin).toBeLessThanOrEqual(dinner.preferEndMin ?? 0);
  });
});

describe("stacked changes and infeasible travel", () => {
  it("approves the presentation move before applying traffic", () => {
    const tasks = demoTasks();
    const baseline = solveBaseline(tasks);
    const first = makeDisruption("presentation", tasks);
    if (!first.ok) throw new Error(first.error);
    const proposed = propose(tasks, first.disruption, baseline.placements);
    if (!proposed.ok) throw new Error(proposed.error);
    const chosen = proposed.proposal.alternatives.find((plan) => plan.id === proposed.proposal.recommendedId)!;
    const committed = commitTasks(proposed.proposal.tasks, chosen);
    expect(committed.find((task) => task.id === "present")?.pinnedStartMin).toBe(at(1, 11, 0));

    const second = makeDisruption("traffic", committed);
    if (!second.ok) throw new Error(second.error);
    const again = propose(committed, second.disruption, chosen.placements);
    if (!again.ok) throw new Error(again.error);
    const recommended = again.proposal.alternatives[0];
    expect(recommended.feasible).toBe(true);
    const present = byId(recommended, "present");
    const commute = byId(recommended, "commute");
    expect(present.startMin).toBe(at(1, 11, 0));
    expect(commute.endMin - commute.startMin).toBe(75);
    expect(present.startMin - commute.endMin).toBe(15);
    expect(placementsOverlap(recommended)).toBe(false);
    expect(commute.startMin).toBe(at(1, 9, 30));
    expect(commute.note).toMatch(/from 45 to 75|from 10:00 AM to 9:30 AM|75/);
    expect(commute.note).toMatch(/9:30 AM/);
    expect(commute.note.toLowerCase()).toContain("15 minutes before");
  });

  it("explains an impossible commute instead of scheduling through sleep", () => {
    const tasks: Task[] = demoTasks()
      .filter((task) => task.id === "sleep" || task.id === "present" || task.id === "commute")
      .map((task) =>
        task.id === "present"
          ? { ...task, pinnedStartMin: at(1, 7, 0) }
          : task.id === "commute"
            ? { ...task, durationMin: 180 }
            : task,
      );
    const plan = solveBaseline(tasks);
    expect(plan.feasible).toBe(false);
    expect(plan.conflicts.some((conflict) => /sleep/i.test(conflict.message))).toBe(true);
    expect(placementsOverlap(plan)).toBe(false);
  });

  it("refuses a duplicate sample disruption", () => {
    const tasks = demoTasks();
    const first = makeDisruption("presentation", tasks);
    if (!first.ok) throw new Error(first.error);
    const moved = tasks.map((task) =>
      task.id === "present" ? { ...task, pinnedStartMin: at(1, 11, 0) } : task,
    );
    const second = makeDisruption("presentation", moved);
    expect(second.ok).toBe(false);
  });
});
