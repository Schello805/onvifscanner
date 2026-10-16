"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type MotionRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MASK_COLUMNS = 20;
const MASK_ROWS = 12;

export function regionsToMaskCells(regions: MotionRegion[]): Set<string> {
  const cells = new Set<string>();
  for (let row = 0; row < MASK_ROWS; row += 1) {
    for (let column = 0; column < MASK_COLUMNS; column += 1) {
      const x = (column + 0.5) / MASK_COLUMNS;
      const y = (row + 0.5) / MASK_ROWS;
      if (
        regions.some(
          (region) =>
            x >= region.x &&
            x <= region.x + region.width &&
            y >= region.y &&
            y <= region.y + region.height
        )
      ) {
        cells.add(`${column}:${row}`);
      }
    }
  }
  return cells;
}

export function maskCellsToRegions(cells: Set<string>): MotionRegion[] {
  const regions: MotionRegion[] = [];
  for (let row = 0; row < MASK_ROWS; row += 1) {
    let runStart = -1;
    for (let column = 0; column <= MASK_COLUMNS; column += 1) {
      const selected = column < MASK_COLUMNS && cells.has(`${column}:${row}`);
      if (selected && runStart < 0) runStart = column;
      if (!selected && runStart >= 0) {
        regions.push({
          x: runStart / MASK_COLUMNS,
          y: row / MASK_ROWS,
          width: (column - runStart) / MASK_COLUMNS,
          height: 1 / MASK_ROWS,
        });
        runStart = -1;
      }
    }
  }
  return regions;
}

type MotionMaskEditorProps = {
  imageSrc?: string;
  regions: MotionRegion[];
  onChange: (regions: MotionRegion[]) => void;
};

export function MotionMaskEditor({
  imageSrc,
  regions,
  onChange,
}: MotionMaskEditorProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<"paint" | "erase">("paint");
  const paintingRef = useRef<{ active: boolean; lastCell: string; cells: Set<string> }>({
    active: false,
    lastCell: "",
    cells: new Set(),
  });

  const cellFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    const x = Math.min(0.9999, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(0.9999, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    const column = Math.floor(x * MASK_COLUMNS);
    const row = Math.floor(y * MASK_ROWS);
    return {
      key: `${column}:${row}`,
    };
  };

  const paintCell = (key: string) => {
    if (paintingRef.current.lastCell === key) return;
    paintingRef.current.lastCell = key;
    if (tool === "paint") paintingRef.current.cells.add(key);
    else paintingRef.current.cells.delete(key);
    onChange(maskCellsToRegions(new Set(paintingRef.current.cells)));
  };

  const selectedCells = regionsToMaskCells(regions);

  return (
    <div data-pull-to-refresh-ignore="true" className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-white">Bewegungsbereiche maskieren</div>
          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
            Male beliebig geformte rote Bereiche ins Bild. Diese Bildteile werden ignoriert.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setTool("paint")}
            className={`rounded-lg border px-2 py-1 text-[10px] font-semibold ${
              tool === "paint"
                ? "border-rose-400/60 bg-rose-500/20 text-rose-200"
                : "border-white/10 text-slate-400"
            }`}
          >
            Malen
          </button>
          <button
            type="button"
            onClick={() => setTool("erase")}
            className={`rounded-lg border px-2 py-1 text-[10px] font-semibold ${
              tool === "erase"
                ? "border-sky-400/60 bg-sky-500/20 text-sky-200"
                : "border-white/10 text-slate-400"
            }`}
          >
            Radieren
          </button>
          {regions.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="rounded-lg border border-white/10 px-2 py-1 text-[10px] font-semibold text-slate-400 hover:text-white"
            >
              Leeren
            </button>
          ) : null}
        </div>
      </div>
      <div
        ref={surfaceRef}
        data-pull-to-refresh-ignore="true"
        className="relative aspect-video w-full touch-none select-none overflow-hidden rounded-lg border border-white/10 bg-slate-900 cursor-crosshair overscroll-none"
        onWheel={(event) => {
          const scrollContainer = event.currentTarget.closest<HTMLElement>("[data-camera-editor-scroll]");
          if (!scrollContainer || event.deltaY === 0) return;
          event.preventDefault();
          event.stopPropagation();
          scrollContainer.scrollTop += event.deltaY;
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const cell = cellFromEvent(event);
          if (!cell) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          paintingRef.current = {
            active: true,
            lastCell: "",
            cells: regionsToMaskCells(regions),
          };
          paintCell(cell.key);
        }}
        onPointerMove={(event) => {
          if (!paintingRef.current.active) return;
          const cell = cellFromEvent(event);
          if (!cell) return;
          event.preventDefault();
          event.stopPropagation();
          paintCell(cell.key);
        }}
        onPointerUp={(event) => {
          event.preventDefault();
          event.stopPropagation();
          paintingRef.current.active = false;
          paintingRef.current.lastCell = "";
        }}
        onPointerCancel={() => {
          paintingRef.current.active = false;
          paintingRef.current.lastCell = "";
        }}
      >
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt="Vorschau für Bewegungsmaske"
            draggable={false}
            className="h-full w-full object-fill opacity-90"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
            Keine Live-Vorschau verfügbar
          </div>
        )}
        <div
          className="pointer-events-none absolute inset-0 grid"
          style={{
            gridTemplateColumns: `repeat(${MASK_COLUMNS}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${MASK_ROWS}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: MASK_COLUMNS * MASK_ROWS }, (_, index) => {
            const column = index % MASK_COLUMNS;
            const row = Math.floor(index / MASK_COLUMNS);
            const selected = selectedCells.has(`${column}:${row}`);
            return (
              <span
                key={index}
                className={selected ? "border border-rose-400/20 bg-rose-500/45" : ""}
              />
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
        <span>{tool === "paint" ? "Wischen markiert Bereiche." : "Wischen entfernt markierte Bereiche."}</span>
        <span>{selectedCells.size}/{MASK_COLUMNS * MASK_ROWS} Felder</span>
      </div>
    </div>
  );
}
