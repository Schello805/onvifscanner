"use client";

import Hls from "hls.js";
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type VideoHTMLAttributes } from "react";

type Props = VideoHTMLAttributes<HTMLVideoElement> & {
  source: string;
  nextSource?: string;
  fallbackSource?: string;
  attempt: number;
  mediaRef: MutableRefObject<HTMLVideoElement | null>;
  startPosition: number;
  rate: number;
  playRequested: boolean;
  scrubbing: boolean;
  onStreamError: (message: string) => void;
  onRecoveryStart: (position: number) => void;
};

function Slot({ source, active, mediaRef, startPosition, rate, playRequested, scrubbing, onStreamError, onRecoveryStart, attempt, nextSource, fallbackSource, ...props }: Props & { active: boolean }) {
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<Hls | null>(null);
  const sourceFailureRef = useRef<string | null>(null);
  const fallbackActionRef = useRef<(() => boolean) | null>(null);
  const fallbackRef = useRef(fallbackSource);
  fallbackRef.current = fallbackSource;
  const initialPosition = useRef(startPosition);
  initialPosition.current = startPosition;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const playRequestedRef = useRef(playRequested);
  playRequestedRef.current = playRequested;
  const scrubbingRef = useRef(scrubbing);
  scrubbingRef.current = scrubbing;
  const errorHandler = useRef(onStreamError);
  errorHandler.current = onStreamError;
  const isActive = useRef(active);
  isActive.current = active;
  const recoveryHandler = useRef(onRecoveryStart);
  recoveryHandler.current = onRecoveryStart;
  const nativeErrorAction = useRef<(() => void) | null>(null);
  const restorePositionAction = useRef<(() => void) | null>(null);
  const readyAction = useRef<(() => void) | null>(null);
  const recovering = useRef(false);
  const lastPosition = useRef(startPosition);

  useEffect(() => {
    const video = elementRef.current;
    if (!video || !source) return;
    lastPosition.current = initialPosition.current;
    sourceFailureRef.current = null;
    let hls: Hls | undefined;
    let usedFallback = false;
    let usedCompatibility = false;
    let mediaRecoveries = 0;
    let standbyMediaFailure = false;
    let mode: "hls" | "compatible" | "original" = "hls";
    let positionToRestore: number | null = null;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    const clearRecoveryTimer = () => { clearTimeout(recoveryTimer); recoveryTimer = undefined; };
    const position = () => positionToRestore ?? (video.currentTime > 0 || (video.readyState >= 1 && !video.error) ? video.currentTime : lastPosition.current);
    const fail = (message: string) => {
      clearRecoveryTimer();
      recovering.current = false;
      sourceFailureRef.current = message;
      hls?.stopLoad();
      video.pause();
      if (isActive.current) errorHandler.current(message);
    };
    const beginRecovery = () => {
      positionToRestore = position();
      recovering.current = true;
      sourceFailureRef.current = null;
      video.pause();
      if (isActive.current) recoveryHandler.current(positionToRestore);
      clearRecoveryTimer();
      recoveryTimer = setTimeout(() => {
        recovering.current = false;
        if (startCompatibility() || playOriginal()) return;
        fail("Die Wiedergabe konnte an dieser Position nicht wiederhergestellt werden. Bitte Verbindung und Aufnahme prüfen.");
      }, 20_000);
    };
    const playOriginal = () => {
      const fallback = fallbackRef.current;
      if (!fallback || usedFallback) return false;
      usedFallback = true;
      beginRecovery();
      mode = "original";
      hls?.destroy();
      hls = undefined;
      controllerRef.current = null;
      video.src = fallback;
      video.load();
      return true;
    };
    const startCompatibility = () => {
      if (usedCompatibility) return false;
      usedCompatibility = true;
      beginRecovery();
      mode = "compatible";
      hls?.destroy();
      hls = undefined;
      controllerRef.current = null;
      const compatible = new URL(source, window.location.href);
      compatible.searchParams.set("compatibility", "1");
      load(compatible.href);
      return true;
    };
    const recoverMedia = () => {
      if (recovering.current && mode === "hls") return true;
      if (hls && mode === "hls" && mediaRecoveries < 1) {
        mediaRecoveries += 1;
        beginRecovery();
        hls.recoverMediaError();
        return true;
      }
      return startCompatibility() || playOriginal();
    };
    const load = (url: string) => {
      if (!Hls.isSupported()) {
        if (!video.canPlayType("application/vnd.apple.mpegurl")) {
          fail("Dieser Browser unterstützt die segmentierte Wiedergabe nicht.");
          return;
        }
        video.src = url;
        video.preload = "auto";
        video.load();
        return;
      }
      hls = new Hls({
        maxBufferLength: scrubbingRef.current ? 6 : 30 * Math.max(1, rateRef.current), maxMaxBufferLength: scrubbingRef.current ? 6 : 30 * Math.max(1, rateRef.current), maxBufferSize: 0,
        backBufferLength: 30, startPosition: positionToRestore ?? initialPosition.current,
        fragLoadingTimeOut: 60_000,
        manifestLoadPolicy: { default: { ...Hls.DefaultConfig.manifestLoadPolicy.default, maxTimeToFirstByteMs: 60_000, maxLoadTimeMs: 90_000 } },
      });
      controllerRef.current = hls;
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        const message = `Videodaten konnten nicht geladen werden (${data.details}${data.response?.code ? `, HTTP ${data.response.code}` : ""}). Bitte erneut starten.`;
        console.warn("[Recording playback]", { mode, type: data.type, details: data.details, status: data.response?.code, position: position() });
        if (!isActive.current) {
          sourceFailureRef.current = message;
          standbyMediaFailure = data.type === Hls.ErrorTypes.MEDIA_ERROR;
          hls?.stopLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR ? recoverMedia() : playOriginal()) return;
        fail(message);
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    };
    fallbackActionRef.current = () => standbyMediaFailure ? recoverMedia() : playOriginal();
    nativeErrorAction.current = () => {
      const error = video.error;
      if (!error || error.code === 1 || (recovering.current && mode === "hls")) return;
      const message = error.code === 2
        ? "Die Videoverbindung wurde unterbrochen. Bitte Verbindung und Speicherziel prüfen."
        : `Der Browser konnte das Video an dieser Position nicht dekodieren (Medienfehler ${error.code}).`;
      console.warn("[Recording playback]", { mode, code: error.code, details: error.message, position: position() });
      if (!isActive.current) {
        sourceFailureRef.current = message;
        standbyMediaFailure = error.code === 3 || error.code === 4;
        hls?.stopLoad();
        return;
      }
      if (error.code === 3 || error.code === 4 ? recoverMedia() : playOriginal()) return;
      fail(message);
    };
    restorePositionAction.current = () => {
      if (positionToRestore === null) return;
      video.playbackRate = rateRef.current;
      video.currentTime = positionToRestore;
    };
    readyAction.current = () => {
      if (!recovering.current || video.readyState < 2 || video.seeking || video.error) return;
      clearRecoveryTimer();
      positionToRestore = null;
      recovering.current = false;
      if (isActive.current && playRequestedRef.current) void video.play().catch(() => undefined);
      else video.pause();
    };
    load(source);
    return () => {
      clearRecoveryTimer();
      recovering.current = false;
      hls?.destroy();
      controllerRef.current = null;
      fallbackActionRef.current = null;
      nativeErrorAction.current = null;
      restorePositionAction.current = null;
      readyAction.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [source]);

  useLayoutEffect(() => {
    const video = elementRef.current;
    if (!video) return;
    if (active) {
      mediaRef.current = video;
      video.playbackRate = rateRef.current;
      if (sourceFailureRef.current) {
        if (!fallbackActionRef.current?.()) errorHandler.current(sourceFailureRef.current);
        return;
      }
      if (video.readyState >= 1) video.dispatchEvent(new Event("loadedmetadata"));
      if (video.readyState >= 3) video.dispatchEvent(new Event("canplay"));
      if (playRequestedRef.current) void video.play().catch(() => undefined);
      else video.pause();
    } else video.pause();
  }, [active, mediaRef]);

  useEffect(() => {
    if (!active || !source) return;
    const timer = window.setTimeout(() => {
      if (!recovering.current && elementRef.current && elementRef.current.readyState < 2) fallbackActionRef.current?.();
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [active, source]);

  useEffect(() => {
    if (active && elementRef.current) {
      elementRef.current.playbackRate = rate;
      if (playRequested) void elementRef.current.play().catch(() => undefined);
      else elementRef.current.pause();
    }
    if (controllerRef.current) {
      controllerRef.current.config.maxBufferLength = scrubbing ? 6 : 30 * Math.max(1, rate);
      controllerRef.current.config.maxMaxBufferLength = scrubbing ? 6 : 30 * Math.max(1, rate);
    }
  }, [active, rate, playRequested, scrubbing]);

  return <video {...(active ? props : {})} ref={elementRef} playsInline disableRemotePlayback muted={active ? props.muted : true}
    preload="auto" style={active ? props.style : { display: "none" }} aria-hidden={!active}
    onError={() => nativeErrorAction.current?.()}
    onLoadedMetadata={(event) => { restorePositionAction.current?.(); if (active) props.onLoadedMetadata?.(event); }}
    onLoadedData={(event) => { readyAction.current?.(); if (active) props.onLoadedData?.(event); }}
    onCanPlay={(event) => { readyAction.current?.(); if (active) props.onCanPlay?.(event); }}
    onSeeked={(event) => { readyAction.current?.(); if (active) props.onSeeked?.(event); }}
    onPlaying={(event) => { readyAction.current?.(); if (active) props.onPlaying?.(event); }}
    onTimeUpdate={(event) => {
      if (recovering.current || event.currentTarget.error || event.currentTarget.readyState < 1) return;
      lastPosition.current = event.currentTarget.currentTime;
      if (active) props.onTimeUpdate?.(event);
    }} />;
}

export function BufferedRecordingVideo(props: Props) {
  const [slots, setSlots] = useState<[string, string]>([props.source, props.nextSource || ""]);
  const [active, setActive] = useState(0);
  const [retries, setRetries] = useState([0, 0]);
  const failed = useRef(false);
  const latest = useRef({ props, slots, active });
  latest.current = { props, slots, active };
  useLayoutEffect(() => {
    if (slots[active] === props.source) return;
    const standby = 1 - active;
    if (slots[standby] === props.source) setActive(standby);
    else setSlots((current) => active === 0 ? [props.source, current[1]] : [current[0], props.source]);
  }, [props.source, slots, active]);
  useEffect(() => {
    if (slots[active] !== props.source) return;
    const standby = 1 - active;
    if (slots[standby] !== (props.nextSource || "")) {
      setSlots((current) => active === 0 ? [current[0], props.nextSource || ""] : [props.nextSource || "", current[1]]);
    }
  }, [props.source, props.nextSource, slots, active]);
  useEffect(() => {
    const current = latest.current;
    if (failed.current && current.slots[current.active] === current.props.source) {
      failed.current = false;
      setRetries((values) => values.map((value, index) => index === current.active ? value + 1 : value));
      return;
    }
    const video = current.props.mediaRef.current;
    if (video && video.readyState >= 1 && current.slots[current.active] === current.props.source) {
      video.dispatchEvent(new Event("loadedmetadata"));
    }
  }, [props.attempt]);
  return <>{slots.map((source, index) => <Slot {...props} key={`${index}-${retries[index]}`} source={source}
    fallbackSource={index === active ? props.fallbackSource : undefined}
    onStreamError={(message) => { failed.current = true; props.onStreamError(message); }}
    active={index === active} startPosition={index === active ? props.startPosition : 0} />)}</>;
}
