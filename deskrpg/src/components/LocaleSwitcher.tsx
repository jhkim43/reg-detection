"use client";
import { useLocale, LOCALES } from "@/lib/i18n";

export default function LocaleSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as typeof locale)}
      className={`bg-gray-700 text-gray-200 text-xs border border-gray-600 rounded px-1.5 py-0.5 cursor-pointer ${className ?? ""}`}
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
