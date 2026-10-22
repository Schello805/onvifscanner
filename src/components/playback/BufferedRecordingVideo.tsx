"use client";

import Hls from "hls.js";
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type VideoHTMLAttributes } from "react";

type Props = VideoHTMLAttributes<HTMLVideoElement> & {
  source: string;
  nextSource?: string;
  attempt: number;
  mediaRef: MutableRefObject<HTMLVideoElement | null>;
  startPosition: number;
  rate: number;
  onStreamError: (message: string) => void;
};

function Slot({ source, active, mediaRef, startPosition, rate, onStreamError, attempt, nextSource, ...props }: Props & { active: boolean }) {
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const initialPosition = useRef(startPosition);
  initialPosition.current = startPosition;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const errorHandler = useRef(onStreamError);
  errorHandler.current = onStreamError;
  const isActive = useRef(active);
  isActive.current = active;

  useEffect(() => {
    const video = elementRef.current;
    if (!video || !source) return;
    let hls: Hls | undefined;
    if (Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: 30, maxMaxBufferLength: 30, maxBufferSize: 0,
        backBufferLength: 12, startPosition: initialPosition.current,
        fragLoadingTimeOut: 60_000,
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal && isActive.current) errorHandler.current("Videodaten konnten nicht geladen werden. Bitte erneut starten.");
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
      if (video.readyState >= 1) video.dispatchEvent(new Event("loadedmetadata"));
      if (video.readyState >= 3) video.dispatchEvent(new Event("canplay"));
      void video.play().catch(() => undefined);
    } else video.pause();
  }, [active, mediaRef]);

  useEffect(() => {
    if (active && elementRef.current) elementRef.current.playbackRate = rate;
  }, [active, rate]);

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
    onStreamError={(message) => { failed.current = true; props.onStreamError(message); }}
    active={index === active} startPosition={index === active ? props.startPosition : 0} />)}</>;
}
