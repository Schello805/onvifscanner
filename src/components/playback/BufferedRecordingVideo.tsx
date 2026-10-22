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
};

function Slot({ source, active, mediaRef, startPosition, rate, playRequested, scrubbing, onStreamError, attempt, nextSource, fallbackSource, ...props }: Props & { active: boolean }) {
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

  useEffect(() => {
    const video = elementRef.current;
    if (!video || !source) return;
    sourceFailureRef.current = null;
    let hls: Hls | undefined;
    let restoreFallback: (() => void) | undefined;
    let usedFallback = false;
    const playOriginal = () => {
      const fallback = fallbackRef.current;
      if (!fallback || usedFallback) return false;
      usedFallback = true;
      const position = video.currentTime || initialPosition.current;
      hls?.destroy();
      controllerRef.current = null;
      restoreFallback = () => {
        video.playbackRate = rateRef.current;
        video.currentTime = position;
      };
      video.addEventListener("loadedmetadata", restoreFallback, { once: true });
      video.src = fallback;
      video.load();
      return true;
    };
    fallbackActionRef.current = playOriginal;
    if (Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: scrubbingRef.current ? 6 : 30 * Math.max(1, rateRef.current), maxMaxBufferLength: scrubbingRef.current ? 6 : 30 * Math.max(1, rateRef.current), maxBufferSize: 0,
        backBufferLength: 30, startPosition: initialPosition.current,
        fragLoadingTimeOut: 60_000,
        manifestLoadPolicy: { default: { ...Hls.DefaultConfig.manifestLoadPolicy.default, maxTimeToFirstByteMs: 60_000, maxLoadTimeMs: 90_000 } },
      });
      controllerRef.current = hls;
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        const message = `Videodaten konnten nicht geladen werden (${data.details}${data.response?.code ? `, HTTP ${data.response.code}` : ""}). Bitte erneut starten.`;
        sourceFailureRef.current = message;
        if (!isActive.current) {
          hls?.stopLoad();
          return;
        }
        if (playOriginal()) return;
        errorHandler.current(message);
      });
      hls.loadSource(source);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source;
      video.preload = "auto";
      video.load();
    } else errorHandler.current("Dieser Browser unterstützt die segmentierte Wiedergabe nicht.");
    return () => {
      hls?.destroy();
      if (restoreFallback) video.removeEventListener("loadedmetadata", restoreFallback);
      controllerRef.current = null;
      fallbackActionRef.current = null;
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
      if (elementRef.current && elementRef.current.readyState < 2) fallbackActionRef.current?.();
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
    onLoadedMetadata={active ? props.onLoadedMetadata : undefined} />;
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
