"use client";

import { ConstraintRail } from "@/components/ConstraintRail";
import { RecoveryPanel } from "@/components/RecoveryPanel";
import { ScheduleStage } from "@/components/ScheduleStage";
import { TopBar } from "@/components/TopBar";
import { makeDisruption, type SampleId } from "@/lib/demo-data";
import { interpretRequest } from "@/lib/interpret";
import { proposeViaMcp, probeMcp, type PlannerChannel } from "@/lib/mcp/client";
import { COMMAND_HINT } from "@/lib/parse-command";
import { propose } from "@/lib/planner";
import { createInitialSession, reducer } from "@/lib/session";
import { clearSession, loadSession, saveSession } from "@/lib/storage";
import type { Disruption, Proposal } from "@/lib/types";
import { useEffect, useReducer, useRef, useState } from "react";

const EVALUATION_MS = 700;

export function AdaptApp() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialSession);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [tool, setTool] = useState<"checking" | "ready" | "offline">("checking");
  const requestRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const loaded = loadSession();
    if (loaded.ok) dispatch({ type: "HYDRATE", state: loaded.state });
    else if (loaded.reason === "invalid") dispatch({ type: "STORAGE_INVALID" });
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveSession(state);
  }, [ready, state]);

  useEffect(() => {
    let cancel = false;
    probeMcp().then((up) => {
      if (!cancel) setTool(up ? "ready" : "offline");
    });
    return () => {
      cancel = true;
    };
  }, []);

  function onReset() {
    requestRef.current += 1;
    busyRef.current = false;
    clearSession();
    dispatch({ type: "RESET" });
    setDraft("");
  }

  async function evaluateDisruption(disruption: Disruption, userText: string, understood: string) {
    if (busyRef.current || state.status.kind === "loading") return;
    if (state.proposal) {
      dispatch({
        type: "ERROR",
        userText,
        text: "Approve or reject the current recovery before starting another change. The accepted plan was not modified.",
      });
      return;
    }

    const snapshotTasks = state.tasks;
    const snapshotPlacements = state.accepted.placements;
    const requestId = ++requestRef.current;
    busyRef.current = true;
    dispatch({ type: "LOADING", userText });

    await new Promise((resolve) => setTimeout(resolve, EVALUATION_MS));
    if (requestId !== requestRef.current) {
      busyRef.current = false;
      return;
    }

    try {
      const remote = await proposeViaMcp(snapshotTasks, snapshotPlacements, disruption);
      if (requestId !== requestRef.current) return;
      let proposal: Proposal | null = null;
      let channel: PlannerChannel = "builtin";
      if (remote.ok) {
        proposal = remote.proposal;
        channel = "mcp";
        setTool("ready");
      } else {
        if (remote.reason === "unavailable" || remote.reason === "off") setTool("offline");
        const local = propose(snapshotTasks, disruption, snapshotPlacements);
        if (!local.ok) {
          dispatch({ type: "ENGINE_FAILED", text: local.error });
          return;
        }
        proposal = local.proposal;
      }
      const note =
        channel === "mcp"
          ? "Calculated by the local planning tool."
          : "The planning tool was unavailable, so the built-in demo scheduler calculated this.";
      dispatch({
        type: "ENGINE_RESULT",
        proposal: {
          ...proposal,
          understood,
          channel,
          detail: `${proposal.detail} Understood: ${understood} ${note}`,
        },
      });
    } catch (error) {
      console.error(error);
      if (requestId !== requestRef.current) return;
      dispatch({
        type: "ENGINE_FAILED",
        text: "The scheduler hit an unexpected error and did not change the plan.",
      });
    } finally {
      if (requestId === requestRef.current) busyRef.current = false;
    }
  }

  function onSample(id: SampleId, userText: string) {
    const made = makeDisruption(id, state.tasks);
    if (!made.ok) {
      dispatch({ type: "ERROR", userText, text: made.error });
      return;
    }
    const understood =
      id === "presentation"
        ? "Studio presentation moved to 11:00 AM."
        : id === "traffic"
          ? "Traffic adds 30 minutes to the commute."
          : "Pick up Noah at the station.";
    void evaluateDisruption(made.disruption, userText, understood);
  }

  function onCommand(raw: string) {
    const text = raw.trim();
    if (!text || state.status.kind === "loading") return;
    const parsed = interpretRequest(text, state.tasks);

    if (parsed.kind === "unknown") {
      dispatch({
        type: "ERROR",
        userText: text,
        text: `That is not one of the sample commands. ${COMMAND_HINT} The plan was not changed.`,
      });
      return;
    }
    if (parsed.kind === "invalid") {
      dispatch({ type: "ERROR", userText: text, text: parsed.message });
      return;
    }

    setDraft("");

    if (parsed.kind === "review" && parsed.command === "help") {
      dispatch({ type: "HELP", userText: text });
      return;
    }
    if (parsed.kind === "review" && parsed.command === "approve") {
      dispatch({ type: "APPROVE" });
      return;
    }
    if (parsed.kind === "review" && parsed.command === "reject") {
      dispatch({ type: "REJECT" });
      return;
    }
    if (parsed.kind === "review" && parsed.command === "reset") {
      onReset();
      return;
    }
    if (parsed.kind === "review" && parsed.command === "select") {
      const plan = state.proposal?.alternatives[parsed.index ?? -1];
      if (!state.proposal || !plan) {
        dispatch({ type: "ERROR", userText: text, text: "That option is not on the current recovery." });
        return;
      }
      if (plan.id !== state.selectedAlternativeId) dispatch({ type: "SELECT", id: plan.id });
      return;
    }
    if (parsed.kind === "prefer-move") {
      const task = state.tasks.find((item) => item.title.toLowerCase().includes(parsed.taskQuery));
      const match = task
        ? state.proposal?.alternatives.find((plan) =>
            plan.placements.some((placement) => placement.taskId === task.id && placement.status === "moved"),
          )
        : undefined;
      if (!state.proposal || !match) {
        dispatch({
          type: "ERROR",
          userText: text,
          text: "Gym stays free to move. Tell me what else changed, and ADAPT will move it only when a recovery needs that time. The accepted plan was not changed.",
        });
        return;
      }
      if (match.id !== state.selectedAlternativeId) dispatch({ type: "SELECT", id: match.id });
      return;
    }
    if (parsed.kind === "sample") {
      onSample(parsed.id, text);
      return;
    }
    if (parsed.kind === "disruption") {
      void evaluateDisruption(parsed.disruption, text, parsed.understood);
    }
  }

  if (!ready) {
    return (
      <main className="grid min-h-dvh place-items-center bg-abyss px-6 text-ink">
        <div>
          <p className="font-display text-4xl">ADAPT</p>
          <p className="mt-3 text-mute">Opening the sample day…</p>
        </div>
      </main>
    );
  }

  const displayTasks = state.proposal?.tasks ?? state.tasks;
  const announcementSource = [...state.messages].reverse().find((message) => message.role === "adapt");

  return (
    <div className="flex min-h-dvh flex-col bg-abyss text-ink lg:h-dvh">
      <a
        href="#schedule"
        className="absolute left-4 top-3 z-10 -translate-y-24 rounded-full bg-cyan px-4 py-2 text-sm font-semibold text-abyss focus:translate-y-0"
      >
        Skip to schedule
      </a>
      <TopBar onReset={onReset} tool={tool} />
      <div className="sr-only" aria-live="polite">
        {state.status.kind === "loading"
          ? "Checking deadlines, travel, sleep, and protected commitments."
          : announcementSource?.text ?? ""}
      </div>
      <div className="flex flex-1 flex-col lg:grid lg:min-h-0 lg:grid-cols-[17rem_minmax(0,1fr)_23rem]">
        <div className="order-1 flex min-h-0 flex-col lg:order-2 lg:h-full lg:overflow-hidden">
          <ScheduleStage
            tasks={displayTasks}
            accepted={state.accepted.placements}
            opening={state.openingPlacements}
            proposal={state.proposal}
            selectedPlanId={state.selectedAlternativeId}
            status={state.status}
            appliedLabels={state.appliedLabels}
            onSelect={(id) => {
              if (id !== state.selectedAlternativeId) dispatch({ type: "SELECT", id });
            }}
            onApprove={() => dispatch({ type: "APPROVE" })}
            onReject={() => dispatch({ type: "REJECT" })}
          />
        </div>
        <div className="order-2 flex min-h-0 flex-col lg:order-3 lg:h-full lg:overflow-hidden">
          <RecoveryPanel
            messages={state.messages}
            draft={draft}
            busy={state.status.kind === "loading"}
            proposalOpen={state.proposal != null}
            onDraft={setDraft}
            onSubmit={onCommand}
            onSample={(id, echo) => onSample(id, echo)}
          />
        </div>
        <div className="order-3 lg:order-1 lg:h-full lg:min-h-0 lg:overflow-hidden">
          <ConstraintRail tasks={state.tasks} />
        </div>
      </div>
    </div>
  );
}
