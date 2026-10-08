type HudProps = {
  readonly locked: boolean;
};

const hints: readonly (readonly [string, string])[] = [
  ["WASD", "move"],
  ["Mouse", "look"],
  ["Shift", "sprint"],
  ["Esc", "release the mouse"],
];

/** Start prompt while the pointer is free; a crosshair dot once it is locked. */
const Hud = ({ locked }: HudProps) =>
  locked ? (
    <div
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-50/70"
    />
  ) : (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-8 bg-black/55 px-6 text-center text-amber-50">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Code Backrooms
        </h1>
        <p className="text-sm tracking-widest text-amber-100/60 uppercase">
          Level 0
        </p>
      </div>
      <p className="animate-pulse text-lg">Click to start walking</p>
      <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-left text-sm text-amber-100/80">
        {hints.map(([key, action]) => (
          <div key={key} className="contents">
            <dt className="font-mono">{key}</dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

export { Hud };
