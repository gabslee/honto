"use client";

import { useSyncExternalStore } from "react";
import { formatTime } from "./web-app-model.js";

const MINUTE = 60_000;
const subscribe = (onChange: () => void) => { const timer = setInterval(onChange, 15_000); return () => clearInterval(timer); };
const currentMinute = () => Math.floor(Date.now() / MINUTE);

/** Partner's local time, rendered on the server and kept current in the browser. */
export function PartnerClock({ timeZone, serverNow }: { timeZone: string; serverNow: number }) {
  const minute = useSyncExternalStore(subscribe, currentMinute, () => Math.floor(serverNow / MINUTE));
  const instant = minute * MINUTE;
  return <time dateTime={new Date(instant).toISOString()}>{formatTime(instant, timeZone)}</time>;
}
