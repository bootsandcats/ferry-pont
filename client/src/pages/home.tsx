import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ArrowRightLeft, RefreshCw, Ship, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Direction = "pontsteiger" | "ndsm";

interface Departure {
  line: string;
  destination: string;
  destinationCode: string;
  expected: string;
  target: string;
  status: string;
  delayMinutes: number;
}

interface FerryResponse {
  departures: Departure[];
  fetchedAt: string;
}

const LABELS: Record<Direction, { from: string; to: string; short: string }> = {
  pontsteiger: { from: "Pontsteiger", to: "NDSM-werf", short: "→ NDSM" },
  ndsm: { from: "NDSM-werf", to: "Pontsteiger", short: "→ Pontsteiger" },
};

const amsterdamClock = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function fmtClock(iso: string): string {
  return amsterdamClock.format(new Date(iso));
}

function fmtCountdown(ms: number): { big: string; unit: string } {
  if (ms <= 0) return { big: "Now", unit: "" };
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const rem = min % 60;
    return { big: `${h}h ${rem}m`, unit: "" };
  }
  if (min === 0) return { big: `${sec}`, unit: "sec" };
  return { big: `${min}:${String(sec).padStart(2, "0")}`, unit: "min" };
}

export default function Home() {
  const [direction, setDirection] = useState<Direction>("pontsteiger");
  const [now, setNow] = useState(() => Date.now());

  // 1-second ticker for the countdown
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Refetch realtime data every 30s, plus when window regains focus
  const { data, isLoading, isError, isFetching, refetch } =
    useQuery<FerryResponse>({
      queryKey: ["/api/ferry", direction],
      queryFn: async () => {
        const res = await apiRequest("GET", `/api/ferry/${direction}`);
        return (await res.json()) as FerryResponse;
      },
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    });

  const upcoming = useMemo(() => {
    if (!data?.departures) return [];
    return data.departures.filter(
      (d) => new Date(d.expected).getTime() > now - 30_000
    );
  }, [data, now]);

  const next = upcoming[0];
  const after = upcoming.slice(1, 5);

  const countdown = next
    ? fmtCountdown(new Date(next.expected).getTime() - now)
    : null;

  const label = LABELS[direction];
  const swap = () =>
    setDirection((d) => (d === "pontsteiger" ? "ndsm" : "pontsteiger"));

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="px-5 pt-6 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
            <Ship className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">Pont F7</div>
            <div className="text-[11px] text-muted-foreground">
              Live · GVB IJ-veren
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh"
          data-testid="button-refresh"
          className="h-9 w-9"
        >
          <RefreshCw
            className={cn("h-4 w-4", isFetching && "animate-spin")}
            strokeWidth={2.25}
          />
        </Button>
      </header>

      {/* Direction selector */}
      <div className="px-5 mt-3">
        <button
          onClick={swap}
          data-testid="button-swap-direction"
          className="group w-full rounded-2xl bg-card border border-card-border px-4 py-3 flex items-center justify-between hover-elevate active-elevate-2"
        >
          <div className="text-left">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              From
            </div>
            <div className="text-base font-semibold leading-tight">
              {label.from}
            </div>
          </div>
          <div className="h-9 w-9 rounded-full bg-accent/15 text-accent-foreground flex items-center justify-center border border-accent/30">
            <ArrowRightLeft className="h-4 w-4" strokeWidth={2.25} />
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              To
            </div>
            <div className="text-base font-semibold leading-tight">
              {label.to}
            </div>
          </div>
        </button>
      </div>

      {/* Countdown */}
      <main className="flex-1 px-5 mt-5 flex flex-col">
        <div className="rounded-3xl bg-gradient-to-b from-primary/12 to-primary/3 border border-primary/20 p-6 text-center relative overflow-hidden">
          {/* Subtle water shimmer */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.06] pointer-events-none"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 20%, hsl(var(--primary)) 0, transparent 45%), radial-gradient(circle at 80% 80%, hsl(var(--accent)) 0, transparent 40%)",
            }}
          />

          <div className="relative">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Next departure
            </div>

            {isLoading && !data ? (
              <div className="mt-5 mb-2">
                <div className="mx-auto h-14 w-40 rounded-xl bg-muted animate-pulse" />
                <div className="mx-auto mt-4 h-4 w-28 rounded bg-muted animate-pulse" />
              </div>
            ) : isError ? (
              <div className="mt-6 flex flex-col items-center gap-2 text-destructive">
                <AlertCircle className="h-6 w-6" />
                <div className="text-sm font-medium">
                  Couldn't reach live data
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => refetch()}
                  data-testid="button-retry"
                >
                  Try again
                </Button>
              </div>
            ) : !next ? (
              <div className="mt-6">
                <div className="text-3xl font-semibold">
                  No more boats
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  The F7 has stopped for today. First ferries are around
                  06:40 (weekdays) / 09:00 (weekends).
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <div
                  className="font-semibold tracking-tight tabular-nums leading-none"
                  style={{ fontSize: "clamp(56px, 22vw, 112px)" }}
                  data-testid="text-countdown"
                >
                  {countdown?.big}
                </div>
                {countdown?.unit && (
                  <div className="text-sm uppercase tracking-[0.18em] text-muted-foreground mt-1">
                    {countdown.unit}
                  </div>
                )}

                <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-background/60 border border-border px-3 py-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Leaves at
                  </span>
                  <span
                    className="font-mono font-semibold"
                    data-testid="text-next-time"
                  >
                    {fmtClock(next.expected)}
                  </span>
                  {next.delayMinutes > 0 && (
                    <span
                      className="text-[11px] font-medium text-destructive"
                      data-testid="text-delay"
                    >
                      +{next.delayMinutes}m
                    </span>
                  )}
                </div>

                <div className="mt-3 text-xs text-muted-foreground">
                  {label.from} → {label.to}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Upcoming list */}
        {after.length > 0 && (
          <section className="mt-6">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground px-1 mb-2">
              After that
            </div>
            <ul
              className="rounded-2xl bg-card border border-card-border divide-y divide-border overflow-hidden"
              data-testid="list-upcoming"
            >
              {after.map((d, i) => {
                const diffMin = Math.max(
                  0,
                  Math.round(
                    (new Date(d.expected).getTime() - now) / 60000
                  )
                );
                return (
                  <li
                    key={`${d.expected}-${i}`}
                    className="flex items-center justify-between px-4 py-3"
                    data-testid={`row-departure-${i}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-7 w-7 rounded-md bg-muted text-muted-foreground flex items-center justify-center text-[11px] font-semibold">
                        F7
                      </div>
                      <div className="font-mono font-semibold tabular-nums text-base">
                        {fmtClock(d.expected)}
                      </div>
                      {d.delayMinutes > 0 && (
                        <span className="text-[11px] font-medium text-destructive">
                          +{d.delayMinutes}m
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground tabular-nums">
                      in {diffMin} min
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="mt-auto pt-6 pb-4 text-center text-[11px] text-muted-foreground">
          {data?.fetchedAt && <>Updated {fmtClock(data.fetchedAt)} · </>}
          Data: GVB realtime via OVapi · Free ferry
        </div>
      </main>
    </div>
  );
}
