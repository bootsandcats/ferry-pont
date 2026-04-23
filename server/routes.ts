import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";

// Timing point codes on the OVapi realtime feed
// 30009900 = Pontsteiger (F7 line starts here, direction 1 → NDSM)
// 30009902 = NDSM-werf ferry quay (F7 direction 2 → Pontsteiger)
const STOPS = {
  pontsteiger: "30009900",
  ndsm: "30009902",
} as const;

type Direction = keyof typeof STOPS;

interface DepartureInfo {
  line: string;
  destination: string;
  destinationCode: string;
  expected: string;      // ISO string with Amsterdam tz offset
  target: string;        // ISO string with Amsterdam tz offset (scheduled)
  status: string;
  delayMinutes: number;
}

// OVapi returns naive ISO strings that are Europe/Amsterdam wall-clock time.
// Make them absolute by attaching the correct Amsterdam offset (CET/CEST)
// so any client (regardless of its own tz) shows the same instant.
function toAmsterdamISO(naive: string): string {
  if (!naive || /([+-]\d{2}:?\d{2}|Z)$/.test(naive)) return naive;
  // Discover Amsterdam offset at that moment using the Intl formatter.
  // Strategy: build a UTC date from the naive string, then iterate by one
  // hour either way and pick the one that formats back to the same wall time
  // in Europe/Amsterdam.
  const [datePart, timePart] = naive.split("T");
  const [Y, M, D] = datePart.split("-").map(Number);
  const [h, m, s = "0"] = timePart.split(":").map(Number as any);

  // Candidate UTC timestamps for offsets +01:00 and +02:00
  const candidates = [1, 2].map((offsetHours) =>
    Date.UTC(Y, (M as number) - 1, D, (h as number) - offsetHours, m as number, Number(s))
  );

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const pad = (n: number) => String(n).padStart(2, "0");
  const want = `${Y}-${pad(M as number)}-${pad(D as number)} ${pad(h as number)}:${pad(m as number)}:${pad(Number(s))}`;

  for (const ts of candidates) {
    const parts = fmt.formatToParts(new Date(ts));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const formatted = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
    if (formatted === want) {
      return new Date(ts).toISOString();
    }
  }
  // Fallback: assume +01:00
  return new Date(candidates[0]).toISOString();
}

async function fetchDepartures(
  direction: Direction
): Promise<{ departures: DepartureInfo[]; fetchedAt: string }> {
  const tpc = STOPS[direction];
  const url = `http://v0.ovapi.nl/tpc/${tpc}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`OVapi HTTP ${res.status}`);
    const json: any = await res.json();
    const passes = json?.[tpc]?.Passes ?? {};

    // Expected destination depends on direction we're asking about
    // From Pontsteiger (30009900) we want boats departing TO NDSM (DestinationCode 'NDSM')
    // From NDSM (30009902) we want boats departing TO Pontsteiger (DestinationCode 'PST')
    const wantDest = direction === "pontsteiger" ? "NDSM" : "PST";

    const now = Date.now();
    const departures: DepartureInfo[] = Object.values(passes)
      .map((p: any) => {
        const expectedRaw: string = p.ExpectedDepartureTime;
        const targetRaw: string = p.TargetDepartureTime ?? expectedRaw;
        const expected = toAmsterdamISO(expectedRaw);
        const target = toAmsterdamISO(targetRaw);
        const delayMs =
          new Date(expected).getTime() - new Date(target).getTime();
        return {
          line: String(p.LinePublicNumber ?? ""),
          destination: String(p.DestinationName50 ?? ""),
          destinationCode: String(p.DestinationCode ?? ""),
          expected,
          target,
          status: String(p.TripStopStatus ?? ""),
          delayMinutes: Math.round(delayMs / 60000),
        };
      })
      .filter(
        (d) =>
          d.line === "F7" &&
          d.destinationCode === wantDest &&
          d.status !== "PASSED" &&
          d.status !== "ARRIVED" &&
          d.status !== "CANCEL" &&
          new Date(d.expected).getTime() > now - 60_000 // tolerate 1 minute in the past
      )
      .sort(
        (a, b) =>
          new Date(a.expected).getTime() - new Date(b.expected).getTime()
      );

    return { departures, fetchedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timeout);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/ferry/:direction", async (req, res) => {
    const dir = req.params.direction as Direction;
    if (!STOPS[dir]) {
      return res.status(400).json({ error: "Unknown direction" });
    }

    try {
      const data = await fetchDepartures(dir);
      // Tell the frontend to aggressively revalidate
      res.set("Cache-Control", "no-store");
      res.json(data);
    } catch (err: any) {
      res.status(502).json({
        error: "Upstream unavailable",
        detail: err?.message ?? String(err),
      });
    }
  });

  return httpServer;
}
