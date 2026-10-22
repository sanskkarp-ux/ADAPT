"use client";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-abyss px-6 text-ink">
      <div className="max-w-md">
        <p className="font-display text-4xl">ADAPT paused</p>
        <p className="mt-3 text-mute">
          Something in the screen failed. The scheduler did not report a successful update.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-full bg-cyan px-5 py-3 font-medium text-abyss"
        >
          Try the screen again
        </button>
      </div>
    </main>
  );
}
