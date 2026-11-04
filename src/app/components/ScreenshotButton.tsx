"use client";
import { useState, type MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import { QRCodeSVG } from "qrcode.react";

async function getMapBlob(map: maplibregl.Map): Promise<Blob> {
  if (!map.loaded()) {
    await new Promise<void>((r) => map.once("idle", () => r()));
  }
  return new Promise<Blob>((resolve, reject) => {
    map.once("render", () => {
      map.getCanvas().toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not create image"))),
        "image/png"
      );
    });
    map.triggerRepaint();
  });
}

export default function ScreenshotButton({
  mapRef,
}: {
  mapRef: MutableRefObject<maplibregl.Map | null>;
}) {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function captureAndUpload() {
    setBusy(true);
    setError("");
    setLink("");
    try {
      const map = mapRef.current;
      if (!map) throw new Error("Map not ready");

      const blob = await getMapBlob(map);

      const body = new FormData();
      body.append("file", blob, `screenshot-${Date.now()}.png`);

      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.viewUrl) throw new Error(data.error ?? "Upload failed");

      setLink(data.viewUrl);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", top: 70, right: 12, zIndex: 9999 }}>
      <button onClick={captureAndUpload} disabled={busy}>
        {busy ? "Working..." : "Screenshot to Drive"}
      </button>

      {link && (
        <div
          style={{
            background: "white",
            color: "black",
            padding: 12,
            marginTop: 4,
            textAlign: "center",
            borderRadius: 8,
          }}
        >
          <QRCodeSVG value={link} size={200} marginSize={2} />
          <div style={{ marginTop: 8 }}>
            <a href={link} target="_blank" rel="noreferrer">Open link</a>
            {" · "}
            <button onClick={() => setLink("")}>Close</button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: "white", color: "red", padding: 8, marginTop: 4, maxWidth: 300 }}>
          {error}
        </div>
      )}
    </div>
  );
}