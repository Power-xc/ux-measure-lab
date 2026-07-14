// SPA route detection. research-sdk.md §5.3: pushState/replaceState do NOT emit
// popstate, so we wrap them (calling the originals first, preserving host-app routing)
// and also listen for popstate (back/forward) and hashchange. Each change yields a
// route observation; the collector then mints a new pvid, resets scroll, and emits pv.

import type { RouteKind } from "./schema.ts";

/** Called with the route kind and the from/to paths (pathname + search + hash). */
export type RouteHandler = (change: { kind: RouteKind; from: string; to: string }) => void;

type HistoryMethod = (data: unknown, unused: string, url?: string | URL | null) => void;

interface RoutingEnv {
  win: Window;
  history: History;
  location: Location;
}

export class RouteWatcher {
  private readonly env: RoutingEnv;
  private readonly handler: RouteHandler;
  private current: string;
  private originalPush: HistoryMethod | null = null;
  private originalReplace: HistoryMethod | null = null;
  private detach: Array<() => void> = [];

  constructor(env: RoutingEnv, handler: RouteHandler) {
    this.env = env;
    this.handler = handler;
    this.current = this.currentUrl();
  }

  private currentUrl(): string {
    const { pathname, search, hash } = this.env.location;
    return `${pathname}${search}${hash}`;
  }

  private fire(kind: RouteKind): void {
    const to = this.currentUrl();
    if (to === this.current) return; // debounce identical-URL churn (§5.3).
    const from = this.current;
    this.current = to;
    this.handler({ kind, from, to });
  }

  start(): void {
    const history = this.env.history as History & { pushState: HistoryMethod; replaceState: HistoryMethod };
    this.originalPush = history.pushState.bind(history);
    this.originalReplace = history.replaceState.bind(history);

    const push: HistoryMethod = (data, unused, url) => {
      (this.originalPush as HistoryMethod)(data, unused, url); // original first — never break the router.
      this.fire("push");
    };
    const replace: HistoryMethod = (data, unused, url) => {
      (this.originalReplace as HistoryMethod)(data, unused, url);
      this.fire("replace");
    };
    history.pushState = push;
    history.replaceState = replace;

    const onPop = (): void => this.fire("pop");
    const onHash = (): void => this.fire("hash");
    this.env.win.addEventListener("popstate", onPop);
    this.env.win.addEventListener("hashchange", onHash);

    this.detach = [
      () => {
        if (this.originalPush) history.pushState = this.originalPush;
        if (this.originalReplace) history.replaceState = this.originalReplace;
      },
      () => this.env.win.removeEventListener("popstate", onPop),
      () => this.env.win.removeEventListener("hashchange", onHash),
    ];
  }

  stop(): void {
    for (const off of this.detach) off();
    this.detach = [];
  }
}
