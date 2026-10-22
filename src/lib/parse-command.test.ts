import { describe, expect, it } from "vitest";
import { parseCommand } from "@/lib/parse-command";

describe("parseCommand", () => {
  it("recognizes the three sample disruptions", () => {
    expect(parseCommand("The presentation moved to 11")).toEqual({ type: "sample", id: "presentation" });
    expect(parseCommand("studio presentation is now at 11:00 AM")).toEqual({ type: "sample", id: "presentation" });
    expect(parseCommand("Traffic adds 30 minutes")).toEqual({ type: "sample", id: "traffic" });
    expect(parseCommand("the commute is 30 minutes longer")).toEqual({ type: "sample", id: "traffic" });
    expect(parseCommand("I need to pick up Noah at the station")).toEqual({ type: "sample", id: "pickup" });
    expect(parseCommand("I have to pick up a friend")).toEqual({ type: "sample", id: "pickup" });
  });

  it("recognizes review commands", () => {
    expect(parseCommand("approve")).toEqual({ type: "approve" });
    expect(parseCommand("Approve changes")).toEqual({ type: "approve" });
    expect(parseCommand("reject")).toEqual({ type: "reject" });
    expect(parseCommand("reset demo")).toEqual({ type: "reset" });
    expect(parseCommand("use option 2")).toEqual({ type: "select", index: 1 });
    expect(parseCommand("help")).toEqual({ type: "help" });
  });

  it("does not invent a meaning for unrelated text", () => {
    expect(parseCommand("hello there")).toEqual({ type: "unknown" });
    expect(parseCommand("   ")).toEqual({ type: "unknown" });
  });
});
