import { describe, expect, it } from "vitest";
import { demoTasks } from "@/lib/demo-data";
import { interpretRequest } from "@/lib/interpret";
import { propose, solveBaseline } from "@/lib/planner";
import { at } from "@/lib/time";

describe("interpretRequest", () => {
  const tasks = demoTasks();

  it("keeps the demo sentences and review words", () => {
    expect(interpretRequest("My presentation moved to 11.", tasks)).toMatchObject({ kind: "sample", id: "presentation" });
    expect(interpretRequest("Traffic is 30 minutes worse.", tasks)).toMatchObject({ kind: "sample", id: "traffic" });
    expect(interpretRequest("I have to pick up Noah from the station.", tasks)).toMatchObject({ kind: "sample", id: "pickup" });
    expect(interpretRequest("approve", tasks)).toMatchObject({ kind: "review", command: "approve" });
    expect(interpretRequest("reject", tasks)).toMatchObject({ kind: "review", command: "reject" });
    expect(interpretRequest("option 2", tasks)).toMatchObject({ kind: "review", command: "select", index: 1 });
    expect(interpretRequest("reset", tasks)).toMatchObject({ kind: "review", command: "reset" });
  });

  it("turns a study sentence into an add-task disruption", () => {
    const request = interpretRequest("Add a 90 minute study session before 10 PM.", tasks);
    expect(request.kind).toBe("disruption");
    if (request.kind !== "disruption" || request.disruption.type !== "add-task") throw new Error("expected add-task");
    expect(request.disruption.task.durationMin).toBe(90);
    expect(request.disruption.task.deadlineMin).toBe(at(0, 22, 0));
    expect(request.understood).toMatch(/90-minute study session/i);

    const baseline = solveBaseline(tasks);
    const result = propose(tasks, request.disruption, baseline.placements);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const feasible = result.proposal.alternatives.filter((plan) => plan.feasible);
    expect(feasible.length).toBeGreaterThan(0);
    for (const plan of feasible) {
      const study = plan.placements.find((placement) => placement.taskId === "study");
      const essay = plan.placements.find((placement) => placement.taskId === "essay");
      expect(study?.endMin).toBeLessThanOrEqual(at(0, 22, 0));
      expect(essay && essay.endMin).toBeLessThanOrEqual(at(0, 23, 59));
    }
  });

  it("rejects an incomplete study request and an unrelated sentence", () => {
    expect(interpretRequest("add a study session", tasks).kind).toBe("invalid");
    expect(interpretRequest("hello there", tasks).kind).toBe("unknown");
    expect(interpretRequest("Move my gym session if necessary.", tasks)).toMatchObject({
      kind: "prefer-move",
      taskQuery: "gym",
    });
  });
});
