/** Base64url JSON cursor для keyset-пагинации (UTF‑8 через TextEncoder). */

export type TitleCursor = { s: "t"; t: string; id: string };
export type RatingCursor = { s: "r"; r: number; id: string };
export type UpdatedCursor = { s: "u"; u: string; id: string };

export type CatalogCursor = TitleCursor | RatingCursor | UpdatedCursor;

export function encodeCatalogCursor(cursor: CatalogCursor): string {
  const json = JSON.stringify(cursor);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCatalogCursor(raw: string | null): CatalogCursor | null {
  if (!raw || !raw.trim()) return null;
  try {
    const s = raw.trim();
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    const o = JSON.parse(json) as Record<string, unknown>;
    if (!o || typeof o !== "object") return null;
    const id = typeof o.id === "string" ? o.id : null;
    if (!id) return null;
    if (o.s === "t" && typeof o.t === "string") {
      return { s: "t", t: o.t, id };
    }
    if (o.s === "r" && typeof o.r === "number" && Number.isFinite(o.r)) {
      return { s: "r", r: o.r, id };
    }
    if (o.s === "u" && typeof o.u === "string") {
      return { s: "u", u: o.u, id };
    }
    return null;
  } catch {
    return null;
  }
}
