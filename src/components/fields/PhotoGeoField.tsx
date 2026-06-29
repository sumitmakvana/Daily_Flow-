import { PhotoField, type PhotoValue } from "./PhotoField";
import { GeoField, type GeoValue } from "./GeoField";

export type PhotoGeoValue = PhotoValue & GeoValue;

/** Composite: capture photo and location together. Stored as a single object. */
export function PhotoGeoField({
  value, onChange, workItemId,
}: {
  value: PhotoGeoValue | null;
  onChange: (v: PhotoGeoValue | null) => void;
  workItemId: string | null;
}) {
  const photo: PhotoValue | null = value
    ? { attachment_id: value.attachment_id, captured_at: value.captured_at }
    : null;
  const geo: GeoValue | null = value
    ? { lat: value.lat, lng: value.lng, accuracy_m: value.accuracy_m, captured_at: value.captured_at }
    : null;

  const setPhoto = (p: PhotoValue | null) => {
    if (!p) { onChange(null); return; }
    if (!geo) { onChange({ ...p, lat: 0, lng: 0 } as PhotoGeoValue); return; }
    onChange({ ...geo, ...p });
  };
  const setGeo = (g: GeoValue | null) => {
    if (!g) { onChange(null); return; }
    if (!photo) { onChange(g as unknown as PhotoGeoValue); return; }
    onChange({ ...photo, ...g });
  };

  return (
    <div className="space-y-2">
      <PhotoField value={photo} onChange={setPhoto} workItemId={workItemId} />
      <GeoField value={geo} onChange={setGeo} />
    </div>
  );
}
