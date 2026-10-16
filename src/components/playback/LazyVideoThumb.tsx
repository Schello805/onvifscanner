"use client";

import { useEffect, useRef, useState } from "react";

type LazyVideoThumbProps = {
  src: string;
  className?: string;
};

/**
 * Lädt die Video-Vorschau nur, solange das Element im sichtbaren Bereich ist.
 * Verhindert, dass dutzende Videos gleichzeitig Speicher belegen.
 */
export function LazyVideoThumb({ src, className }: LazyVideoThumbProps) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = holderRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { rootMargin: "100px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={holderRef} className="absolute inset-0">
      {visible && (
        <video
          src={src}
          preload="metadata"
          className={className}
          muted
          playsInline
        />
      )}
    </div>
  );
}
