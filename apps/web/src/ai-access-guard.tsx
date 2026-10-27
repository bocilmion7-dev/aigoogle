import { useEffect } from "react";
import { getAiWallet, getMe } from "./session-api";

/**
 * Middleware akses global (level aplikasi):
 * di semua halaman yang butuh login, masa langganan/demo AI divalidasi.
 * Jika habis → paksa ke /subscription. Token habis TIDAK redirect di sini
 * (ditangani popup saat fitur AI dipakai).
 */
export function AiAccessGuard() {
  useEffect(() => {
    const path = window.location.pathname;
    const publicPaths = ["/", "/login", "/platform", "/set-password", "/subscription"];
    if (publicPaths.includes(path)) return;

    void getMe()
      .then(async (me) => {
        // platform operator & sesi kosong tidak terkena gate perusahaan
        if (!me || me.tenant.provider === "platform") return;
        const w = await getAiWallet().catch(() => null);
        if (w?.access?.reason === "subscription") window.location.replace("/subscription");
      })
      .catch(() => null);
  }, []);

  return null;
}
