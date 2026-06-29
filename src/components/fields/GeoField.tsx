import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MapPin, Loader2, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export type GeoValue = { lat: number; lng: number; accuracy_m?: number; captured_at?: string };

const DEFAULT_ACCURACY_THRESHOLD_M = 50;
const MAX_ATTEMPTS = 3;

/**
 * Field-grade geolocation capture with retry + accuracy threshold.
 *
 * Phase E3 hardening:
 *  - Retries up to 3 times to converge on the accuracy threshold (default 50m).
 *  - Surfaces best-effort fallback when the threshold can't be met.
 *  - Shows current accuracy quality (Good / Fair / Poor) in the UI.
 */
export function GeoField({
  value, onChange, accuracyThresholdM = DEFAULT_ACCURACY_THRESHOLD_M,
}: {
  value: GeoValue | null;
  onChange: (v: GeoValue | null) => void;
  accuracyThresholdM?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const getOne = (): Promise<GeolocationPosition> => new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve, reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });

  const capture = async () => {
    if (!("geolocation" in navigator)) { toast.error("Geolocation not supported"); return; }
    setBusy(true);
    let best: GeolocationPosition | null = null;
    try {
      for (let i = 1; i <= MAX_ATTEMPTS; i++) {
        setAttempt(i);
        try {
          const pos = await getOne();
          if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
          if (pos.coords.accuracy <= accuracyThresholdM) break;
          // brief settle delay before next sample
          await new Promise((r) => setTimeout(r, 600));
        } catch (err) {
          if (i === MAX_ATTEMPTS && !best) throw err;
        }
      }
      if (!best) throw new Error("Could not fix location");
      onChange({
        lat: best.coords.latitude,
        lng: best.coords.longitude,
        accuracy_m: Math.round(best.coords.accuracy),
        captured_at: new Date().toISOString(),
      });
      if (best.coords.accuracy > accuracyThresholdM) {
        toast.warning(`Low accuracy: ±${Math.round(best.coords.accuracy)}m — move outdoors for a better fix.`);
      } else {
        toast.success(`Location captured (±${Math.round(best.coords.accuracy)}m)`);
      }
    } catch (err) {
      toast.error(`Location failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setAttempt(0);
    }
  };

  const quality = value?.accuracy_m == null
    ? null
    : value.accuracy_m <= 20 ? { label: "Good", cls: "text-emerald-600" }
    : value.accuracy_m <= accuracyThresholdM ? { label: "Fair", cls: "text-amber-600" }
    : { label: "Poor", cls: "text-red-600" };

  return (
    <div className="space-y-1">
      {value ? (
        <div className="flex items-center gap-2 text-xs rounded-md border border-border bg-muted/40 px-2 py-1.5">
          <MapPin className="h-3 w-3 text-emerald-600" />
          <a
            href={`https://www.openstreetmap.org/?mlat=${value.lat}&mlon=${value.lng}#map=17/${value.lat}/${value.lng}`}
            target="_blank" rel="noreferrer" className="underline"
          >
            {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          </a>
          {value.accuracy_m != null && (
            <span className={"text-muted-foreground " + (quality?.cls ?? "")}>
              ±{value.accuracy_m}m {quality ? `· ${quality.label}` : ""}
            </span>
          )}
          {quality?.label === "Poor" && <AlertTriangle className="h-3 w-3 text-red-600" />}
          <Button type="button" size="sm" variant="ghost" className="ml-auto h-6 w-6 p-0" onClick={() => onChange(null)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={capture} className="min-h-9">
          {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <MapPin className="h-3 w-3 mr-1" />}
          {busy ? `Locating… (try ${attempt}/${MAX_ATTEMPTS})` : "Capture location"}
        </Button>
      )}
    </div>
  );
}
