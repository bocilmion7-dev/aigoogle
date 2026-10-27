import { useEffect, useState } from "react";
import { getAiWallet, getConnections, getMe, getWaStatus } from "./api";
import { driveStatus } from "./drive-api";
import { IconCheck, IconChevron } from "./icons";

interface Step {
  done: boolean;
  label: string;
  hint: string;
  href: string;
}

export function OnboardingChecklist() {
  const [steps, setSteps] = useState<Step[] | null>(null);

  useEffect(() => {
    void (async () => {
      const [me, conns, drive, wa, wallet] = await Promise.all([
        getMe().catch(() => null),
        getConnections().catch(() => []),
        driveStatus().catch(() => ({ connected: false, engine: "google" as const })),
        getWaStatus().catch(() => null),
        getAiWallet().catch(() => null),
      ]);
      const accurate = conns.find((c) => c.provider === "accurate")?.status === "connected";
      setSteps([
        {
          done: !!me && !me.needsPassword,
          label: "Buat password",
          hint: "Bisa login tanpa membuka Accurate setiap kali.",
          href: "/set-password",
        },
        {
          done: accurate,
          label: "Hubungkan Accurate",
          hint: "Sumber data akuntansi Anda.",
          href: "/settings",
        },
        {
          done: !!drive.connected,
          label: "Hubungkan Google Drive",
          hint: "Rapikan faktur & nota otomatis.",
          href: "/explore",
        },
        {
          done: !!wa?.connected,
          label: "Hubungkan WhatsApp",
          hint: "Notifikasi jatuh tempo & AI penjaga toko.",
          href: "/whatsapp",
        },
        {
          done: !!wallet && wallet.access?.reason !== "token",
          label: "Aktifkan akses AI",
          hint: "Langganan atau saldo token cukup.",
          href: wallet?.access?.reason === "subscription" ? "/subscription" : "/saldo",
        },
      ]);
    })();
  }, []);

  if (!steps) return null;
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;

  return (
    <section className="setup-card" aria-label="Langkah awal">
      <div className="setup-head">
        <div>
          <strong className="setup-title">Selesaikan setup</strong>
          <p className="setup-sub">Aktifkan semua fitur dengan melengkapi langkah berikut.</p>
        </div>
        <span className="setup-badge">{done}/{steps.length}</span>
      </div>

      <div className="setup-progress" aria-hidden="true">
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>

      <div className="setup-list">
        {steps.map((s, i) => (
          <a
            key={s.label}
            href={s.done ? undefined : s.href}
            className={`setup-step${s.done ? " is-done" : ""}`}
            aria-disabled={s.done}
          >
            <span className="setup-step__mark" aria-hidden="true">
              {s.done ? <IconCheck size={13} /> : i + 1}
            </span>
            <span className="setup-step__body">
              <strong>{s.label}</strong>
              {!s.done && <span>{s.hint}</span>}
            </span>
            {!s.done && <IconChevron size={15} />}
          </a>
        ))}
      </div>
    </section>
  );
}
