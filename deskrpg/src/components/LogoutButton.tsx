"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";

export default function LogoutButton() {
  const router = useRouter();
  const t = useT();

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/auth");
  };

  return (
    <button
      onClick={handleLogout}
      className="px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded transition-colors"
    >
      {t("common.logout")}
    </button>
  );
}
