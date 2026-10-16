"use client";

import { useEffect, useRef, useState } from "react";

type WebRtcPlayerProps = {
  whepUrl?: string;
  playbackUrl: string;
  title: string;
  className?: string;
  style?: React.CSSProperties;
};

export function WebRtcPlayer({
  whepUrl,
  playbackUrl,
  title,
  className,
  style,
}: WebRtcPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [useIframeFallback, setUseIframeFallback] = useState(!whepUrl);

  useEffect(() => {
    if (!whepUrl) {
      setUseIframeFallback(true);
      return;
    }

    setUseIframeFallback(false);
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let sessionUrl: string | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connectWhep = async (attempt = 0) => {
      if (cancelled) return;
      try {
        pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });

        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });

        pc.ontrack = (event) => {
          const videoEl = videoRef.current;
          if (!videoEl || !event.streams[0]) return;
          if (videoEl.srcObject !== event.streams[0]) {
            videoEl.srcObject = event.streams[0];
            videoEl.play().catch(() => {});
          }
        };

        pc.onconnectionstatechange = () => {
          if (cancelled || !pc) return;
          if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
            if (attempt < 2) {
              pc.close();
              retryTimer = setTimeout(() => void connectWhep(attempt + 1), 900);
            } else {
              setUseIframeFallback(true);
            }
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await new Promise<void>((resolve) => {
          if (!pc || pc.iceGatheringState === "complete") {
            resolve();
            return;
          }
          const timeout = setTimeout(() => {
            pc?.removeEventListener("icegatheringstatechange", checkState);
            resolve();
          }, 1200);
          const checkState = () => {
            if (pc?.iceGatheringState === "complete") {
              clearTimeout(timeout);
              pc.removeEventListener("icegatheringstatechange", checkState);
              resolve();
            }
          };
          pc.addEventListener("icegatheringstatechange", checkState);
        });

        if (cancelled || !pc.localDescription) return;

        const res = await fetch(whepUrl, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: pc.localDescription.sdp,
        });

        if (!res.ok) {
          if (attempt < 2) {
            pc.close();
            retryTimer = setTimeout(() => void connectWhep(attempt + 1), 800);
            return;
          }
          throw new Error(`WHEP HTTP ${res.status}`);
        }

        const locationHeader = res.headers.get("location");
        if (locationHeader) {
          sessionUrl = locationHeader;
        }

        const answerSdp = await res.text();
        if (cancelled) return;

        await pc.setRemoteDescription({
          type: "answer",
          sdp: answerSdp,
        });
      } catch {
        if (!cancelled) {
          setUseIframeFallback(true);
        }
      }
    };

    void connectWhep();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (pc) {
        try {
          pc.close();
        } catch {}
      }
      if (sessionUrl) {
        fetch(sessionUrl, { method: "DELETE" }).catch(() => {});
      }
    };
  }, [whepUrl]);

  if (useIframeFallback) {
    return (
      <iframe
        src={playbackUrl}
        title={title}
        allow="autoplay; fullscreen"
        className={className}
        style={style}
      />
    );
  }

  return (
    <video
      ref={videoRef}
      title={title}
      autoPlay
      playsInline
      muted
      controls={false}
      className={className}
      style={style}
    />
  );
}
