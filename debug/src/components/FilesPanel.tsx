import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api.js";

interface PdfArtifactRow {
  _id: string;
  artifactId: string;
  conversationId?: string;
  kind: string;
  filename: string;
  signedUrl?: string;
  thumbnailUrl?: string;
  fileSizeBytes: number;
  pageCount: number;
  createdAt: number;
}

const KIND_LABEL: Record<string, string> = {
  brief: "Brief",
  invoice: "Invoice",
  itinerary: "Itinerary",
  resume: "Resume",
  newsletter: "Newsletter",
  reference: "Reference",
};

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FilesPanel({ isDark }: { isDark: boolean }) {
  const rows = (useQuery(api.pdfArtifacts.listAll, { limit: 100 }) ??
    []) as unknown as PdfArtifactRow[];
  const [selected, setSelected] = useState<PdfArtifactRow | null>(null);

  const cardCls = isDark
    ? "bg-slate-900/60 border-slate-800 hover:border-slate-700"
    : "bg-white border-slate-200 hover:border-slate-300";
  const subCls = isDark ? "text-slate-500" : "text-slate-400";
  const headCls = isDark ? "text-slate-300" : "text-slate-700";

  return (
    <div className="flex h-full gap-4">
      <div className="flex-1 min-w-0 overflow-auto">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className={`text-lg font-semibold ${headCls}`}>Files</h2>
          <span className={`text-xs ${subCls}`}>{rows.length} artifacts</span>
        </div>
        {rows.length === 0 ? (
          <div className={`text-sm ${subCls} py-8 text-center`}>
            No PDFs yet. Text Boop something like "make me an invoice for $X to Y".
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map((row) => (
              <button
                key={row._id}
                onClick={() => setSelected(row)}
                className={`text-left border rounded-lg overflow-hidden transition-colors ${cardCls} ${
                  selected?._id === row._id ? "ring-2 ring-sky-500" : ""
                }`}
              >
                <div
                  className={`aspect-[200/283] ${isDark ? "bg-slate-950" : "bg-slate-100"} flex items-center justify-center overflow-hidden`}
                >
                  {row.thumbnailUrl ? (
                    <img
                      src={row.thumbnailUrl}
                      alt={row.filename}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className={`text-xs ${subCls}`}>no thumbnail</span>
                  )}
                </div>
                <div className="p-2.5">
                  <div className={`text-[10px] uppercase tracking-wider ${subCls} mb-0.5`}>
                    {KIND_LABEL[row.kind] ?? row.kind}
                  </div>
                  <div
                    className={`text-xs font-medium truncate ${headCls}`}
                    title={row.filename}
                  >
                    {row.filename}
                  </div>
                  <div className={`text-[11px] ${subCls} mt-1 flex justify-between`}>
                    <span>
                      {row.pageCount}p · {formatBytes(row.fileSizeBytes)}
                    </span>
                    <span>{formatTime(row.createdAt)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div
          className={`w-[480px] shrink-0 border rounded-lg flex flex-col ${cardCls.replace("hover:border-slate-700", "").replace("hover:border-slate-300", "")}`}
        >
          <div
            className={`px-3 py-2 border-b ${isDark ? "border-slate-800" : "border-slate-200"} flex items-center justify-between`}
          >
            <div className={`text-xs font-medium truncate ${headCls}`}>
              {selected.filename}
            </div>
            <button
              onClick={() => setSelected(null)}
              className={`text-xs ${subCls} hover:underline`}
            >
              close
            </button>
          </div>
          {selected.signedUrl ? (
            <iframe
              src={selected.signedUrl}
              className="flex-1 w-full"
              title={selected.filename}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
              No URL
            </div>
          )}
          <div
            className={`px-3 py-2 border-t ${isDark ? "border-slate-800" : "border-slate-200"} text-[11px] ${subCls} flex justify-between`}
          >
            <span>{selected.artifactId}</span>
            {selected.conversationId && <span>{selected.conversationId}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
