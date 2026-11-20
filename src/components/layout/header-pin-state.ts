/**
 * The phone header pin (#1089) as a pure state machine, driven by the page scroll offset.
 * - null: at the top, the header sits in the flow as usual;
 * - "parked": the header has left the viewport; it becomes sticky but stays translated out, without a transition;
 * - "shown": scrolled up by PIN_SHOW_UP since the lowest point, the logo/tools and search rows slide back in;
 * - "hidden": scrolled down by PIN_HIDE_DOWN since the highest point while shown, they slide out again.
 * Within the header's own height the rows never hide: a parked header returns to the flow, a hidden one comes back,
 * and a shown one stays until the top, so the header's empty slot never shows as a blank band.
 * `anchor` is the scroll extreme the next flip is measured from.
 */
export type HeaderPin = null | "parked" | "shown" | "hidden";
export type PinTrack = { pin: HeaderPin; anchor: number };

export const PIN_SHOW_UP = 24;
export const PIN_HIDE_DOWN = 8;

export function nextHeaderPin(track: PinTrack, y: number, headerHeight: number): PinTrack {
  if (y <= 0) return { pin: null, anchor: 0 };
  if (track.pin === null) return y > headerHeight ? { pin: "parked", anchor: y } : track;
  if (track.pin === "shown") {
    const anchor = Math.min(track.anchor, y);
    return y > headerHeight && y - anchor >= PIN_HIDE_DOWN ? { pin: "hidden", anchor: y } : { pin: "shown", anchor };
  }
  if (y <= headerHeight) return track.pin === "parked" ? { pin: null, anchor: 0 } : { pin: "shown", anchor: y };
  const anchor = Math.max(track.anchor, y);
  return anchor - y >= PIN_SHOW_UP ? { pin: "shown", anchor: y } : { pin: track.pin, anchor };
}
