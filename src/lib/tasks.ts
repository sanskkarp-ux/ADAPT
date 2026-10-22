import type { Task } from "@/lib/types";

/** Copy a task so a disruption cannot mutate the accepted plan. */
export function cloneTask(task: Task): Task {
  return {
    ...task,
    dependsOn: [...task.dependsOn],
  };
}
