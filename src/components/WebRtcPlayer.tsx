"use client";

import { useEffect, useRef, useState } from "react";

type WebRtcPlayerProps = {
  whepUrl?: string;
  playbackUrl: string;
  title: string;
  className?: string;
  style?: React.CSSProperties;
  iceServers?: RTCIceServer[];
};

export function WebRtcPlayer({
  whepUrl,
  playbackUrl,
  title,
  className,
  style,
  iceServers,
}: WebRtcPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [useIframeFallback, setUseIframeFallback] = useState(!whepUrl);

  useEffect(() => {
    // Only use iframe fallback if whepUrl is missing or RTCPeerConnection is unsupported
    if (!whepUrl || typeof window === "undefined" || !("RTCPeerConnection" in window)) {
      setUseIframeFallback(true);
      return;
    }

    setUseIframeFallback(false);
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let sessionUrl: string | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attemptCount = 0;

    const cleanupCurrentPc = () => {
      if (pc) {
        try {
          pc.ontrack = null;
          pc.onconnectionstatechange = null;
          pc.oniceconnectionstatechange = null;
          pc.close();
        } catch {}
        pc = null;
      }
      if (sessionUrl) {
        const urlToDelete = sessionUrl;
        sessionUrl = null;
        fetch(urlToDelete, { method: "DELETE" }).catch(() => {});
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      cleanupCurrentPc();
      if (retryTimer) clearTimeout(retryTimer);
      attemptCount++;
      // Progressive backoff: 1s, 2s, 3s, capped at 5s
      const delay = Math.min(1000 * Math.min(attemptCount, 5), 5000);
      retryTimer = setTimeout(() => {
        if (!cancelled) void connectWhep();
      }, delay);
    };

    const connectWhep = async () => {
      if (cancelled) return;
      cleanupCurrentPc();

      try {
        const configuredIceServers =
          iceServers ??
          (process.env.NEXT_PUBLIC_STUN_SERVER
            ? [{ urls: process.env.NEXT_PUBLIC_STUN_SERVER }]
            : []);

        const peer = new RTCPeerConnection({
          ...(configuredIceServers.length > 0 ? { iceServers: configuredIceServers } : {}),
        });
        pc = peer;

        peer.addTransceiver("video", { direction: "recvonly" });
        peer.addTransceiver("audio", { direction: "recvonly" });

        peer.ontrack = (event) => {
          attemptCount = 0; // Stream received successfully, reset backoff
          const videoEl = videoRef.current;
          if (!videoEl || !event.streams[0]) return;
          if (videoEl.srcObject !== event.streams[0]) {
            videoEl.srcObject = event.streams[0];
            videoEl.play().catch(() => {});
          }
        };

        const handleDisconnect = () => {
          if (cancelled || pc !== peer) return;
          const state = peer.connectionState;
          const iceState = peer.iceConnectionState;
          if (
            state === "failed" ||
            state === "disconnected" ||
            iceState === "failed" ||
            iceState === "disconnected"
          ) {
            scheduleReconnect();
          }
        };

        peer.onconnectionstatechange = handleDisconnect;
        peer.oniceconnectionstatechange = handleDisconnect;

        const offer = await peer.createOffer();
        if (cancelled || pc !== peer) return;
        await peer.setLocalDescription(offer);

        await new Promise<void>((resolve) => {
          if (peer.iceGatheringState === "complete") {
            resolve();
            return;
          }
          const timeout = setTimeout(() => {
            peer.removeEventListener("icegatheringstatechange", checkState);
            resolve();
          }, 1000);
          const checkState = () => {
            if (peer.iceGatheringState === "complete") {
              clearTimeout(timeout);
              peer.removeEventListener("icegatheringstatechange", checkState);
              resolve();
            }
          };
          peer.addEventListener("icegatheringstatechange", checkState);
        });

        if (cancelled || pc !== peer || !peer.localDescription) return;

        const res = await fetch(whepUrl, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: peer.localDescription.sdp,
        });

        if (!res.ok) {
          scheduleReconnect();
          return;
        }

        const locationHeader = res.headers.get("location");
        if (locationHeader) {
          sessionUrl = locationHeader;
        }

        const answerSdp = await res.text();
        if (cancelled || pc !== peer) return;

        await peer.setRemoteDescription({
          type: "answer",
          sdp: answerSdp,
        });
      } catch {
        if (!cancelled) {
          scheduleReconnect();
        }
      }
    };

    void connectWhep();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        if (!pc || pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          void connectWhep();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (retryTimer) clearTimeout(retryTimer);
      cleanupCurrentPc();
    };
  }, [whepUrl, iceServers]);

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
