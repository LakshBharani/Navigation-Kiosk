"use client";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

export default function ScreenshotButton() {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function captureAndUpload() {
    setBusy(true);
    setError("");
    setLink("");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        preferCurrentTab: true,
      } as any);

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise((r) => requestAnimationFrame(r));

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      stream.getTracks().forEach((t) => t.stop());

      const blob = await new Promise<Blob | null>((r) =>
        canvas.toBlob(r, "image/png")
      );
      if (!blob) throw new Error("Could not create image");

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
    <div style={{ position: "fixed", top: 12, right: 12, zIndex: 9999 }}>
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