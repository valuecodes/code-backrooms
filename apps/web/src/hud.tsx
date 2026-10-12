import type { ZoneProgress } from "~/use-area-world";

type HudProps = {
  readonly locked: boolean;
  readonly seed: number;
  readonly rooms: number;
  /** Modules of a code world generated so far and in all, each its own area. */
  readonly modules: { readonly built: number; readonly total: number };
  /** The zone the player is in, with its modules generated so far and in all. */
  readonly zone: ZoneProgress | null;
  /** Milliseconds the last module generated on the way took, or null. */
  readonly lastMs: number | null;
  readonly preset: string | null;
  /** The code world's example, zip or folder name; null for other worlds. */
  readonly label: string | null;
  /** Where the player is: `file · fn()` for code worlds, else the room id. */
  readonly place: string | null;
  /** The navigation stack, callers first: `main() → login()`. */
  readonly breadcrumb: string | null;
  /** What the door or portal in front of the player leads to. */
  readonly prompt: string | null;
  readonly warnings: readonly string[];
  /** Files a local world left out: too large or not parsed. */
  readonly notices: readonly string[];
  readonly error: string | null;
};

const hints: readonly (readonly [string, string])[] = [
  ["WASD", "move"],
  ["Mouse", "look"],
  ["Shift", "sprint"],
  ["Backspace", "return to the caller"],
  ["R", "back to the entrance"],
  ["N", "next seed"],
  ["M", "local map"],
  ["Tab", "world map"],
  ["Esc", "release the mouse"],
];

/** Only a code world has source to show. */
const codeHints: readonly (readonly [string, string])[] = [
  ["E", "show the source"],
  ["Wheel", "scroll the source"],
];

/** `6 modules` once all are generated, `2/6 modules · last 14 ms` on the way. */
const modulesOf = ({
  modules: { built, total },
  lastMs,
}: Pick<HudProps, "modules" | "lastMs">): string | null => {
  if (total <= 1) {
    return null;
  }
  const count = built < total ? `${built}/${total}` : `${total}`;
  return lastMs === null
    ? `${count} modules`
    : `${count} modules · last ${Math.round(lastMs)} ms`;
};

/** `seed 7 · code self · 3/105 modules · web 2/40` for a code world. */
const whereOf = ({
  seed,
  rooms,
  modules,
  zone,
  lastMs,
  preset,
  label,
}: Pick<
  HudProps,
  "seed" | "rooms" | "modules" | "zone" | "lastMs" | "preset" | "label"
>): string => {
  if (label !== null) {
    const count = modulesOf({ modules, lastMs });
    const parts = [`seed ${seed}`, `code ${label}`];
    if (count !== null) {
      parts.push(count);
    }
    if (zone !== null) {
      parts.push(`${zone.name} ${zone.built}/${zone.total}`);
    }
    return parts.join(" · ");
  }
  return `seed ${seed} · ${preset ?? `${rooms} rooms`}`;
};

/** Start prompt while the pointer is free; a crosshair dot once it is locked. */
const Hud = ({
  locked,
  place,
  breadcrumb,
  prompt,
  warnings,
  notices,
  error,
  ...rest
}: HudProps) => {
  const where = whereOf(rest);
  const keys = rest.label === null ? hints : [...hints, ...codeHints];
  if (locked) {
    return (
      <>
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-50/70"
        />
        {prompt !== null && (
          <p className="pointer-events-none absolute top-1/2 left-1/2 mt-4 -translate-x-1/2 font-mono text-sm text-amber-50/80">
            {prompt}
          </p>
        )}
        <div className="pointer-events-none absolute bottom-3 left-4 flex flex-col gap-0.5 font-mono text-xs text-amber-100/50">
          {warnings.length > 0 && (
            <p className="text-amber-300/60">
              {warnings.length} connections or portals not laid out
            </p>
          )}
          {notices.length > 0 && (
            <p className="text-amber-300/60">{notices.join(" · ")}</p>
          )}
          {breadcrumb !== null && (
            <p className="text-amber-100/70">{breadcrumb}</p>
          )}
          <p>{place === null ? where : `${where} · ${place}`}</p>
        </div>
      </>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-8 bg-black/55 px-6 text-center text-amber-50">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Code Backrooms
        </h1>
        <p className="text-sm tracking-widest text-amber-100/60 uppercase">
          Level 0 · {where}
        </p>
      </div>
      {error === null ? (
        <p className="animate-pulse text-lg">Click to start walking</p>
      ) : (
        <p className="max-w-prose font-mono text-sm text-red-300">{error}</p>
      )}
      {warnings.length > 0 && (
        <ul className="max-w-prose font-mono text-xs text-amber-300/70">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {notices.length > 0 && (
        <ul className="max-w-prose font-mono text-xs text-amber-300/70">
          {notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-left text-sm text-amber-100/80">
        {keys.map(([key, action]) => (
          <div key={key} className="contents">
            <dt className="font-mono">{key}</dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

export { Hud };
