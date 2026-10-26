import { useEffect, useState } from "react";

/** Re-render every minute while `active`, so elapsed durations on screen stay current. */
export function useMinuteTick(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, [active]);
}
