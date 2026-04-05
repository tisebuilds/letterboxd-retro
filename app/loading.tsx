export default function Loading() {
  const placeholders = Array.from({ length: 16 }, (_, i) => i);

  const cols = 5;
  const gapX = 48;
  const gapY = 48;
  const cardW = 160;
  const cardH = 284;
  const margin = 320;

  return (
    <main className="fixed inset-0 overflow-hidden overscroll-none bg-[#111]">
      <div className="film-grain z-[1]" aria-hidden />

      <div className="absolute inset-0 z-[2] cursor-grab touch-none select-none">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{
            width: margin * 2 + cols * cardW + (cols - 1) * gapX,
            height:
              margin * 2 +
              Math.ceil(placeholders.length / cols) * cardH +
              (Math.ceil(placeholders.length / cols) - 1) * gapY,
          }}
        >
          {placeholders.map((i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = margin + col * (cardW + gapX);
            const y = margin + row * (cardH + gapY);
            return (
              <div
                key={i}
                className="absolute"
                style={{ left: x, top: y, width: cardW }}
                aria-hidden
              >
                <div className="box-border flex h-[284px] w-[160px] shrink-0 flex-col overflow-hidden border border-[#e0e0e0] bg-white shadow-[0_8px_22px_rgba(0,0,0,0.35)]">
                  <div className="h-[224px] w-full shrink-0 bg-neutral-300/70" />
                  <div className="flex h-[58px] shrink-0 items-center gap-1.5 px-3 py-2">
                    <div className="h-1.5 w-5 rounded-sm bg-neutral-300/80" />
                    <div className="h-4 w-3 rounded-sm bg-neutral-300/80" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
