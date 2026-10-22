import type { SampleId } from "@/lib/demo-data";
import { COMMAND_HINT } from "@/lib/parse-command";
import type { ChatMessage } from "@/lib/types";
import { useEffect, useRef } from "react";

const SAMPLES: { id: SampleId; title: string; detail: string }[] = [
  {
    id: "presentation",
    title: "Presentation moves to 11:00 AM",
    detail: "Studio 204 starts later than the sample plan.",
  },
  {
    id: "traffic",
    title: "Traffic adds 30 minutes",
    detail: "Sample commute only. Not a live traffic report.",
  },
  {
    id: "pickup",
    title: "Pick up Noah at 5:00 PM",
    detail: "Thirty minutes at Central Station.",
  },
];

export function RecoveryPanel({
  messages,
  draft,
  busy,
  proposalOpen,
  onDraft,
  onSubmit,
  onSample,
}: {
  messages: ChatMessage[];
  draft: string;
  busy: boolean;
  proposalOpen: boolean;
  onDraft: (value: string) => void;
  onSubmit: (value: string) => void;
  onSample: (id: SampleId, echo: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, busy]);

  return (
    <aside className="flex h-full flex-col border-t border-line lg:min-h-0 lg:border-l lg:border-t-0">
      <div className="border-b border-line px-4 py-4 sm:px-5">
        <h2 className="font-display text-3xl">Recovery log</h2>
        <p className="mt-1 text-sm leading-6 text-mute">
          Say what changed in the sample day. ADAPT answers with a schedule, not a guess.
        </p>
      </div>

      <ol data-testid="chat-log" className="max-h-80 space-y-4 overflow-y-auto px-4 py-4 sm:px-5 lg:max-h-none lg:min-h-0 lg:flex-1">
        {messages.length === 0 ? (
          <li className="text-sm text-mute">The log is empty. Reset the sample day if this stays blank.</li>
        ) : null}
        {messages.map((message) => (
          <li
            key={message.id}
            data-testid="message"
            data-role={message.role}
            className={`border-l-2 pl-3 ${
              message.tone === "error"
                ? "border-bad"
                : message.tone === "warning"
                  ? "border-amber"
                  : message.tone === "success"
                    ? "border-ok"
                    : message.role === "user"
                      ? "border-sand"
                      : "border-cyan"
            }`}
          >
            <p className="text-sm text-mute">{message.role === "user" ? "You" : "ADAPT"}</p>
            <p className="mt-1 text-sm leading-6">{message.text}</p>
          </li>
        ))}
        <div ref={bottomRef} />
      </ol>

      <div className="border-t border-line px-4 py-4 sm:px-5">
        <p className="text-sm font-semibold">Sample disruptions</p>
        <div className="mt-3 space-y-2">
          {SAMPLES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              data-testid={`disruption-${sample.id}`}
              disabled={busy || proposalOpen}
              onClick={() => onSample(sample.id, sample.title)}
              className="w-full rounded-xl border border-line px-3 py-3 text-left hover:border-cyan disabled:cursor-not-allowed disabled:text-mute"
            >
              <span className="block text-sm font-medium">{sample.title}</span>
              <span className="mt-1 block text-sm text-mute">{sample.detail}</span>
            </button>
          ))}
        </div>
        {proposalOpen ? (
          <p className="mt-3 text-sm leading-6 text-amber">Approve or reject the current recovery before the next change.</p>
        ) : null}

        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(draft);
          }}
        >
          <label htmlFor="change" className="text-sm font-semibold">
            Tell ADAPT what changed
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="change"
              data-testid="chat-input"
              value={draft}
              disabled={busy}
              maxLength={240}
              onChange={(event) => onDraft(event.target.value)}
              placeholder="The presentation moved to 11"
              className="min-h-11 w-full rounded-xl border border-line bg-abyss px-3 py-2 text-sm text-ink placeholder:text-mute"
            />
            <button
              type="submit"
              data-testid="send"
              disabled={busy || draft.trim().length === 0}
              className="rounded-full border border-ink bg-ink px-4 py-2 text-sm font-semibold text-abyss disabled:border-line disabled:bg-transparent disabled:text-mute disabled:opacity-100"
            >
              Send
            </button>
          </div>
          <p className="mt-2 text-sm leading-6 text-mute">{COMMAND_HINT}</p>
        </form>
      </div>
    </aside>
  );
}
