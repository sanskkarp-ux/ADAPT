export function TopBar({
  onReset,
  tool,
}: {
  onReset: () => void;
  tool: "checking" | "ready" | "offline";
}) {
  const toolLabel =
    tool === "ready" ? "Planning tool on" : tool === "offline" ? "Demo scheduler" : "Checking planning tool";
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-4 py-3 sm:px-6">
      <div>
        <p className="font-display text-[1.7rem] leading-none tracking-tight">ADAPT</p>
        <p className="mt-1 text-sm text-ink">Adaptive Daily Planning & Recovery</p>
        <p className="mt-1 max-w-xl text-sm text-mute">
          When life changes, ADAPT recalculates your day instead of making you rebuild it.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="rounded-full border border-line px-3 py-1 text-sm text-ink">Simulated Alexa+</p>
        <p className="rounded-full border border-cyan/30 bg-cyandim px-3 py-1 text-sm text-cyan">Sample data</p>
        <p
          data-testid="planner-tool"
          data-state={tool}
          className={`rounded-full border px-3 py-1 text-sm ${tool === "ready" ? "border-ok/40 text-ok" : "border-line text-mute"}`}
        >
          {toolLabel}
        </p>
        <button
          type="button"
          data-testid="reset"
          onClick={onReset}
          className="rounded-full border border-line px-4 py-2 text-sm text-ink hover:border-cyan hover:text-cyan"
        >
          Reset sample day
        </button>
      </div>
    </header>
  );
}
