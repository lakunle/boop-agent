import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api.js";

interface ToggleSetting {
  key: string;
  label: string;
  description: string;
  // When the row is absent (value === null), what should the toggle show?
  defaultEnabled: boolean;
}

const SETTINGS: ToggleSetting[] = [
  {
    key: "proactive_enabled",
    label: "Proactive email surfacing",
    description:
      "Watch new Gmail messages. When something important arrives, you'll get an iMessage. Turn off to silence the watcher entirely without disconnecting Gmail.",
    defaultEnabled: true,
  },
];

export function SettingsPanel({ isDark }: { isDark: boolean }) {
  const muted = isDark ? "text-slate-500" : "text-slate-400";

  return (
    <div className="flex flex-col h-full -m-5">
      <div
        className={`shrink-0 border-b px-5 py-3 flex items-center gap-3 ${
          isDark ? "border-slate-800" : "border-slate-200"
        }`}
      >
        <h2
          className={`text-xs font-semibold uppercase tracking-wider ${
            isDark ? "text-slate-500" : "text-slate-400"
          }`}
        >
          Agent Settings
        </h2>
        <span className={`text-xs mono ${muted}`}>
          {SETTINGS.length} toggle{SETTINGS.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto debug-scroll p-5 space-y-3">
        {SETTINGS.map((s) => (
          <SettingRow key={s.key} setting={s} isDark={isDark} />
        ))}
      </div>
    </div>
  );
}

function SettingRow({
  setting,
  isDark,
}: {
  setting: ToggleSetting;
  isDark: boolean;
}) {
  const value = useQuery(api.settings.get, { key: setting.key });
  const setSetting = useMutation(api.settings.set);

  const loading = value === undefined;
  const enabled = loading
    ? setting.defaultEnabled
    : value === null
      ? setting.defaultEnabled
      : value !== "false";

  async function toggle() {
    if (loading) return;
    await setSetting({ key: setting.key, value: enabled ? "false" : "true" });
  }

  const cardBg = isDark
    ? "bg-slate-900/40 border-slate-800/60"
    : "bg-white border-slate-200";

  return (
    <div
      className={`border rounded-xl p-4 flex items-start justify-between gap-6 fade-in ${cardBg}`}
    >
      <div className="min-w-0 flex-1">
        <div
          className={`text-sm font-medium ${
            isDark ? "text-slate-200" : "text-slate-800"
          }`}
        >
          {setting.label}
        </div>
        <div
          className={`text-xs mt-1 leading-relaxed ${
            isDark ? "text-slate-400" : "text-slate-600"
          }`}
        >
          {setting.description}
        </div>
        <div
          className={`text-[10px] mono mt-2 ${
            isDark ? "text-slate-600" : "text-slate-400"
          }`}
        >
          settings.{setting.key} ={" "}
          {loading
            ? "…"
            : value === null
              ? `(unset, default ${setting.defaultEnabled ? "true" : "false"})`
              : `"${value}"`}
        </div>
      </div>

      <button
        onClick={toggle}
        disabled={loading}
        role="switch"
        aria-checked={enabled}
        aria-label={`Toggle ${setting.label}`}
        className={`relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
          loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
        } ${
          enabled
            ? isDark
              ? "bg-emerald-500 focus:ring-emerald-500/50 focus:ring-offset-slate-950"
              : "bg-emerald-500 focus:ring-emerald-500/50 focus:ring-offset-white"
            : isDark
              ? "bg-slate-700 focus:ring-slate-500/50 focus:ring-offset-slate-950"
              : "bg-slate-300 focus:ring-slate-400/50 focus:ring-offset-white"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
