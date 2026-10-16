"use client";

type PtzControlPadProps = {
  isOpen: boolean;
  isBusy: boolean;
  cameraId: string;
  onSendCommand: (
    cameraId: string,
    action: "move" | "stop",
    x?: number,
    y?: number,
    zoom?: number
  ) => void;
};

export function PtzControlPad({
  isOpen,
  isBusy,
  cameraId,
  onSendCommand,
}: PtzControlPadProps) {
  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed bottom-[max(16px,env(safe-area-inset-bottom))] right-[max(12px,env(safe-area-inset-right))] z-[100000] flex flex-col items-center gap-2 rounded-2xl border border-white/15 bg-black/75 p-3 text-white shadow-2xl backdrop-blur-xl"
    >
      <div className="flex w-full items-center justify-between gap-3 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
        <span>ONVIF PTZ</span>
        {isBusy ? <span className="text-emerald-400 animate-pulse">Bewegt…</span> : null}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <span />
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSendCommand(cameraId, "move", 0, 0.6, 0);
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSendCommand(cameraId, "stop");
          }}
          onPointerCancel={() => onSendCommand(cameraId, "stop")}
          onPointerLeave={() => {
            if (isBusy) onSendCommand(cameraId, "stop");
          }}
          className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-xl border border-white/15 bg-white/10 text-base font-bold active:bg-emerald-600/80"
          aria-label="Nach oben neigen"
        >
          ▲
        </button>
        <span />
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSendCommand(cameraId, "move", -0.6, 0, 0);
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSendCommand(cameraId, "stop");
          }}
          onPointerCancel={() => onSendCommand(cameraId, "stop")}
          onPointerLeave={() => {
            if (isBusy) onSendCommand(cameraId, "stop");
          }}
          className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-xl border border-white/15 bg-white/10 text-base font-bold active:bg-emerald-600/80"
          aria-label="Nach links schwenken"
        >
          ◀
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSendCommand(cameraId, "stop");
          }}
          className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-300 active:bg-rose-600/70"
          title="Bewegung stoppen"
          aria-label="Bewegung stoppen"
        >
          ■
        </button>
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSendCommand(cameraId, "move", 0.6, 0, 0);
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSendCommand(cameraId, "stop");
          }}
          onPointerCancel={() => onSendCommand(cameraId, "stop")}
          onPointerLeave={() => {
            if (isBusy) onSendCommand(cameraId, "stop");
          }}
          className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-xl border border-white/15 bg-white/10 text-base font-bold active:bg-emerald-600/80"
          aria-label="Nach rechts schwenken"
        >
          ▶
        </button>
        <span />
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSendCommand(cameraId, "move", 0, -0.6, 0);
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSendCommand(cameraId, "stop");
          }}
          onPointerCancel={() => onSendCommand(cameraId, "stop")}
          onPointerLeave={() => {
            if (isBusy) onSendCommand(cameraId, "stop");
          }}
          className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-xl border border-white/15 bg-white/10 text-base font-bold active:bg-emerald-600/80"
          aria-label="Nach unten neigen"
        >
          ▼
        </button>
        <span />
      </div>
      <div className="grid w-full grid-cols-2 gap-1.5 border-t border-white/10 pt-2">
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSendCommand(cameraId, "move", 0, 0, -0.5);
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSendCommand(cameraId, "stop");
          }}
          onPointerCancel={() => onSendCommand(cameraId, "stop")}
          onPointerLeave={() => {
            if (isBusy) onSendCommand(cameraId, "stop");
          }}
          className="flex h-9 touch-manipulation items-center justify-center rounded-lg border border-white/15 bg-white/10 text-xs font-bold active:bg-emerald-600/80"
          aria-label="Herauszoomen"
        >
          − Zoom
        </button>
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSendCommand(cameraId, "move", 0, 0, 0.5);
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSendCommand(cameraId, "stop");
          }}
          onPointerCancel={() => onSendCommand(cameraId, "stop")}
          onPointerLeave={() => {
            if (isBusy) onSendCommand(cameraId, "stop");
          }}
          className="flex h-9 touch-manipulation items-center justify-center rounded-lg border border-white/15 bg-white/10 text-xs font-bold active:bg-emerald-600/80"
          aria-label="Hineinzoomen"
        >
          + Zoom
        </button>
      </div>
    </div>
  );
}
