"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  label: string;
  min?: number;
  max: number;
  value: number;
  formatValue: (value: number) => string;
  onSeek: (value: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onPreview?: (value: number | null, ratio: number) => void;
  className: string;
  children: (value: number) => ReactNode;
};

export function PlaybackScrubber({ min = 0, ...props }: Props) {
  const [preview, setPreview] = useState<number | null>(null);
  const pointer = useRef<number | null>(null);
  const queued = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeek = useRef(-Infinity);
  const committed = useRef<number | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const commit = (value: number) => {
    queued.current = null;
    if (committed.current === value) return;
    committed.current = value;
    lastSeek.current = performance.now();
    latest.current.onSeek(value);
  };
  const update = (element: HTMLDivElement, clientX: number, final = false) => {
    const rect = element.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const value = min + ratio * (props.max - min);
    props.onPreview?.(value, ratio);
    if (pointer.current === null) return;
    setPreview(value);
    clearTimer();
    const delay = Math.max(0, 150 - (performance.now() - lastSeek.current));
    if (final || delay === 0) commit(value);
    else {
      queued.current = value;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (queued.current !== null) commit(queued.current);
      }, delay);
    }
  };
  const finish = () => {
    if (pointer.current === null) return;
    clearTimer();
    queued.current = null;
    pointer.current = null;
    setPreview(null);
    latest.current.onScrubEnd();
  };

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (pointer.current !== null) latest.current.onScrubEnd();
  }, []);

  const value = Math.max(min, Math.min(props.max, preview ?? props.value));
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-valuemin={min}
      aria-valuemax={props.max}
      aria-valuenow={value}
      aria-valuetext={props.formatValue(value)}
      className={`${props.className} focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400`}
      style={{ touchAction: "none" }}
      onPointerDown={(event) => {
        if (event.button !== 0 || pointer.current !== null || (event.target as Element).closest("[data-scrub-marker]")) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = event.pointerId;
        committed.current = null;
        lastSeek.current = -Infinity;
        props.onScrubStart();
        update(event.currentTarget, event.clientX);
      }}
      onPointerMove={(event) => {
        if (pointer.current !== null && pointer.current !== event.pointerId) return;
        update(event.currentTarget, event.clientX);
      }}
      onPointerUp={(event) => {
        if (pointer.current !== event.pointerId) return;
        update(event.currentTarget, event.clientX, true);
        finish();
        if (event.pointerType !== "mouse") props.onPreview?.(null, 0);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={(event) => { if (pointer.current === event.pointerId) { finish(); props.onPreview?.(null, 0); } }}
      onLostPointerCapture={(event) => { if (pointer.current === event.pointerId) finish(); }}
      onPointerLeave={() => { if (pointer.current === null) props.onPreview?.(null, 0); }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 10 : 1;
        const target = event.key === "Home" ? min : event.key === "End" ? props.max
          : event.key === "ArrowLeft" || event.key === "ArrowDown" ? value - step
          : event.key === "ArrowRight" || event.key === "ArrowUp" ? value + step
          : event.key === "PageDown" ? value - (props.max - min) / 10
          : event.key === "PageUp" ? value + (props.max - min) / 10 : null;
        if (target === null) return;
        event.preventDefault();
        event.stopPropagation();
        props.onScrubStart();
        props.onSeek(Math.max(min, Math.min(props.max, target)));
        props.onScrubEnd();
      }}
    >
      {props.children(value)}
    </div>
  );
}
