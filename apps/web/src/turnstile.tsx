import { useEffect, useRef, useState } from "react";

// Cloudflare Turnstile, the check a visitor passes before this site fetches a
// repository from GitHub for them (`api/github-zip.ts` verifies the token). The
// script loads only once the GitHub field is used, so folder and example visits
// never contact Cloudflare's challenge servers.

type TurnstileApi = {
  readonly render: (
    container: HTMLElement,
    options: {
      readonly sitekey: string;
      readonly theme: "dark";
      readonly callback: (token: string) => void;
      readonly "expired-callback": () => void;
      readonly "error-callback": () => void;
    }
  ) => string;
  readonly remove: (widgetId: string) => void;
};

/** The global the script installs, if it has run. */
const installedApi = (): TurnstileApi | undefined =>
  (globalThis as { readonly turnstile?: TurnstileApi }).turnstile;

const SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Cloudflare's public always-pass test key, used by `pnpm dev` when no key is
 * configured. Production builds never fall back to it.
 */
const TEST_SITE_KEY = "1x00000000000000000000AA";

/** The site key the build was given, the test key in dev, else null (GitHub loading off). */
const turnstileSiteKey = (): string | null => {
  const configured: unknown = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  if (typeof configured === "string" && configured !== "") {
    return configured;
  }
  return import.meta.env.DEV ? TEST_SITE_KEY : null;
};

let loading: Promise<TurnstileApi> | null = null;

/** Adds the script once; a failed load may be retried. */
const loadTurnstile = (): Promise<TurnstileApi> => {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.onload = () => {
      const api = installedApi();
      if (api === undefined) {
        reject(new Error("Turnstile did not start"));
      } else {
        resolve(api);
      }
    };
    script.onerror = () => {
      script.remove();
      loading = null;
      reject(new Error("Turnstile could not load"));
    };
    document.head.append(script);
  });
  return loading;
};

/**
 * One Turnstile widget. `onToken` gets each passed check's token, and null
 * when it expires or fails. Remount (change `key`) for a fresh token: each
 * token is accepted once.
 */
const TurnstileCheck = ({
  siteKey,
  onToken,
}: {
  readonly siteKey: string;
  readonly onToken: (token: string | null) => void;
}) => {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let widget: string | null = null;
    loadTurnstile().then(
      (api) => {
        if (live && box.current !== null) {
          widget = api.render(box.current, {
            sitekey: siteKey,
            theme: "dark",
            callback: (token) => onToken(token),
            "expired-callback": () => onToken(null),
            "error-callback": () => onToken(null),
          });
        }
      },
      () => {
        if (live) {
          setFailed(true);
        }
      }
    );
    return () => {
      live = false;
      if (widget !== null) {
        installedApi()?.remove(widget);
      }
      onToken(null);
    };
  }, [siteKey, onToken]);
  return failed ? (
    <p className="text-red-300">the verification check could not load</p>
  ) : (
    <div ref={box} />
  );
};

export { TurnstileCheck, turnstileSiteKey };
