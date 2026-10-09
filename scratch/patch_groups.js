const fs = require('fs');
let code = fs.readFileSync('src/app/wall/page.tsx', 'utf8');

// Replace state variables for drag index
code = code.replace(/const \[draggedIndex, setDraggedIndex\] = useState<number \| null>\(null\);/, 'const [draggedId, setDraggedId] = useState<string | null>(null);');
code = code.replace(/const \[dragOverIndex, setDragOverIndex\] = useState<number \| null>\(null\);/, 'const [dragOverId, setDragOverId] = useState<string | null>(null);');

// Generate the new render block
const renderBlock = `
        {Object.entries(
          cameras.reduce((acc, camera) => {
            const g = camera.group?.trim() || "Ungruppiert";
            if (!acc[g]) acc[g] = [];
            acc[g].push(camera);
            return acc;
          }, {} as Record<string, WallCamera[]>)
        ).sort((a, b) => a[0] === "Ungruppiert" ? 1 : b[0] === "Ungruppiert" ? -1 : a[0].localeCompare(b[0])).map(([groupName, groupCameras]) => (
          <div key={groupName} className="mb-8 last:mb-0">
            {groupName !== "Ungruppiert" && (
              <h2 className="mb-3 px-2 text-lg font-semibold text-white/90 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                {groupName}
              </h2>
            )}
            <div className="wall-grid" style={{ "--wall-columns": columns, "--wall-columns-mobile": mobileColumns } as React.CSSProperties}>
              {groupCameras.map((camera) => {
                const image = images[camera.id];
                const isLive = liveCameras.has(camera.id);
                const isOffline = camera.status && camera.status.isOnline === false;
                return (
                  <article 
                    key={camera.id} 
                    draggable={!isFullscreen}
                    onDragStart={(e) => {
                      setDraggedId(camera.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!draggedId || draggedId === camera.id) return;
                      setDragOverId(camera.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverId === camera.id) setDragOverId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverId(null);
                      if (!draggedId || draggedId === camera.id) return;
                      const next = [...cameras];
                      const fromIdx = next.findIndex(c => c.id === draggedId);
                      const toIdx = next.findIndex(c => c.id === camera.id);
                      if (fromIdx >= 0 && toIdx >= 0) {
                        const [moved] = next.splice(fromIdx, 1);
                        next.splice(toIdx, 0, moved);
                        persist(next);
                      }
                      setDraggedId(null);
                    }}
                    onDragEnd={() => {
                      setDraggedId(null);
                      setDragOverId(null);
                    }}
                    className={\`group overflow-hidden transition-all flex flex-col justify-center \${
                      expandedCameraId === camera.id 
                        ? 'fixed inset-0 z-[99999] bg-black' 
                        : \`relative rounded-2xl border bg-black shadow-2xl \${isOffline ? 'border-red-500 ring-2 ring-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.3)]' : isLive ? 'border-sky-500 ring-2 ring-sky-500/50 shadow-[0_0_15px_rgba(14,165,233,0.3)]' : 'border-white/10'} \${dragOverId === camera.id ? 'opacity-50 scale-105 border-indigo-500' : ''}\`
                    }\`}
                  >
`;

const regex = /<div className="wall-grid"[^>]*>[\s\S]*?className=\{`group overflow-hidden transition-all flex flex-col justify-center[^>]*>/;
code = code.replace(regex, renderBlock);

// Replace closing tags for cameras map
code = code.replace(/<\/article>\s*\)\s*\}\)\}\s*<\/div>/, '</article>\n                );\n              })}\n            </div>\n          </div>\n        ))}');

fs.writeFileSync('src/app/wall/page.tsx', code);
