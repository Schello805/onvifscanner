import re

with open('src/app/wall/page.tsx', 'r') as f:
    content = f.read()

# 1. Update CameraEditDraft type
content = re.sub(
    r'password: string;',
    r'password: string;\n  group: string;',
    content
)

# 2. Update openEditor
content = re.sub(
    r'password: camera\.credentials\?\.password \?\? "",',
    r'password: camera.credentials?.password ?? "",\n      group: camera.group ?? "",',
    content
)

# 3. Update saveCameraDetails
content = re.sub(
    r'overlayPosition: editDraft\.overlayPosition',
    r'group: editDraft.group.trim() || undefined,\n      overlayPosition: editDraft.overlayPosition',
    content
)

# 4. Add UI input
input_html = r"""                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs text-slate-400">Gruppe (z. B. Garten, Haus)</span>
                    <input value={editDraft.group} onChange={(event) => setEditDraft({ ...editDraft, group: event.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm outline-none" />
                  </label>"""
content = re.sub(
    r'</label>\s*</div>\s*</div>\s*<label className="grid gap-1\.5 mt-2">',
    input_html + r'\n                </div>\n              </div>\n\n              <label className="grid gap-1.5 mt-2">',
    content
)

# 5. Render loop grouping
render_orig = r"""<div className="wall-grid" style={{ "--wall-columns": columns, "--wall-columns-mobile": mobileColumns } as CSSProperties}>
          {cameras.map((camera, index) => {"""

render_new = r"""<div className="flex flex-col gap-8">
          {Object.entries(
            cameras.reduce((acc, camera) => {
              const g = camera.group?.trim() || "Ungruppiert";
              if (!acc[g]) acc[g] = [];
              acc[g].push(camera);
              return acc;
            }, {} as Record<string, WallCamera[]>)
          ).sort((a, b) => a[0] === "Ungruppiert" ? 1 : b[0] === "Ungruppiert" ? -1 : a[0].localeCompare(b[0])).map(([groupName, groupCameras]) => (
            <div key={groupName} className="flex flex-col gap-3">
              {groupName !== "Ungruppiert" && (
                <h2 className="px-2 text-lg font-semibold text-white/90 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                  {groupName}
                </h2>
              )}
              <div className="wall-grid" style={{ "--wall-columns": columns, "--wall-columns-mobile": mobileColumns } as CSSProperties}>
                {groupCameras.map((camera) => {
                  const index = cameras.findIndex(c => c.id === camera.id);"""

content = content.replace(render_orig, render_new)

# 6. Close the new elements
content = re.sub(
    r'</article>\s*\);\s*}\)\}\s*</div>\s*\)}',
    r'</article>\n                );\n              })}\n              </div>\n            </div>\n          ))}\n        </div>\n      )}',
    content
)

with open('src/app/wall/page.tsx', 'w') as f:
    f.write(content)
