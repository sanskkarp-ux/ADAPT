type BannerKind = "loading" | "success" | "error" | "rejected" | "conflict";

const STYLE: Record<BannerKind, { label: string; box: string }> = {
  loading: { label: "Checking", box: "border-cyan/40 bg-cyandim text-cyan" },
  success: { label: "Approved", box: "border-ok/40 bg-okdim text-ok" },
  error: { label: "Not changed", box: "border-bad/40 bg-baddim text-bad" },
  rejected: { label: "Rejected", box: "border-line bg-raised text-ink" },
  conflict: { label: "Conflict", box: "border-amber/40 bg-amberdim text-amber" },
};

export function StateBanner({ kind, text }: { kind: BannerKind; text: string }) {
  const style = STYLE[kind];
  return (
    <div
      data-testid="status-banner"
      data-kind={kind}
      className={`rounded-2xl border px-4 py-3 ${style.box}`}
    >
      <p className="text-sm font-semibold">{style.label}</p>
      <p className="mt-1 text-sm leading-6 text-ink">{text}</p>
    </div>
  );
}
