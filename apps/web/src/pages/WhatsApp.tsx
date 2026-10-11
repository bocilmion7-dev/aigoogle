import { useCallback, useEffect, useState } from "react";

interface WaStatus {
  connected: boolean;
  account: { wabaId: string; phoneNumberId: string; displayName: string; status: string } | null;
  balance: number;
  costPerMessage: number;
  rupiahPerCredit: number;
  settings: { autoDueDate: boolean; dailyReport: boolean; ownerPhone: string };
  metaConfigured: boolean;
  embedUrl: string | null;
  billingEnabled: boolean;
  recent: Array<{ id: string; to: string; body: string; status: string; error: string; createdAt: string }>;
}

const card: React.CSSProperties = {
  border: "1px solid #e3ddd4", borderRadius: 6, padding: 16, marginBottom: 12,
  background: "#faf8f5", fontFamily: "system-ui",
};
const btn: React.CSSProperties = {
  border: "none", borderRadius: 4, padding: "8px 14px", cursor: "pointer",
  background: "#3d6b54", color: "white", fontSize: 14,
};
const input: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 4, border: "1px solid #ccc",
  fontSize: 14, marginBottom: 8, boxSizing: "border-box", fontFamily: "inherit",
};

export function WhatsApp() {
  const [st, setSt] = useState<WaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(10000);
  const [ownerPhone, setOwnerPhone] = useState("");
  const [autoDue, setAutoDue] = useState(false);
  const [daily, setDaily] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void fetch("/api/wa/status")
      .then((r) => r.json())
      .then((j: WaStatus) => {
        setSt(j);
        setOwnerPhone(j.settings.ownerPhone);
        setAutoDue(j.settings.autoDueDate);
        setDaily(j.settings.dailyReport);
      });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!st) return <p style={{ padding: 24, fontFamily: "system-ui" }}>Memuat…</p>;

  async function saveSettings() {
    setBusy(true);
    try {
      await fetch("/api/wa/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoDueDate: autoDue, dailyReport: daily, ownerPhone }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function topup() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/wa/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const j = (await res.json()) as { error?: string; orderId?: string; credits?: number };
      if (res.status === 503 && j.orderId) {
        // billing dormant → mock settle untuk dev
        const s = await fetch(`/api/wa/topup/${j.orderId}/mock-settle`, { method: "POST" });
        if (s.ok) {
          load();
          alert(`Topup mock settle: +${j.credits} kredit`);
          return;
        }
      }
      if (!res.ok) setError(j.error ?? "Gagal topup");
      else load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 640, margin: "0 auto", padding: 16 }}>
      <h1 style={{ fontSize: 20, color: "#3d6b54" }}>WhatsApp</h1>
      <a href="/app" style={{ color: "#3d6b54", fontSize: 14 }}>← Dashboard</a>

      <section style={{ ...card, marginTop: 12 }}>
        <strong>Status</strong>
        <p style={{ fontSize: 14, color: "#555" }}>
          {st.connected ? `Terhubung (${st.account?.displayName || st.account?.phoneNumberId})` : "Belum terhubung"}
        </p>
        <p style={{ fontSize: 14 }}>
          Saldo: <strong>{st.balance}</strong> kredit · {st.rupiahPerCredit} Rp/kirim
        </p>
      </section>

      <section style={card}>
        <strong>Daftar sebagai agregator (Meta Embedded Signup)</strong>
        <p style={{ fontSize: 13, color: "#666" }}>
          Platform kami membayar Meta. Anda daftarkan nomor bisnis Anda lewat form Meta di bawah.
          {!st.metaConfigured && " (Credential Meta App belum diset — menu aktif setelah konfigurasi.)"}
        </p>
        {st.embedUrl ? (
          <iframe
            title="Meta WhatsApp Embedded Signup"
            src={st.embedUrl}
            style={{ width: "100%", height: 480, border: "1px solid #ddd", borderRadius: 6, background: "#fff" }}
          />
        ) : (
          <p style={{ fontSize: 13, color: "#888" }}>Embed signup siap setelah META_APP_ID & META_EMBEDDED_CONFIG_ID diisi.</p>
        )}
      </section>

      <section style={card}>
        <strong>Topup saldo</strong>
        <p style={{ fontSize: 13, color: "#666" }}>1 kredit = {st.rupiahPerCredit} rupiah (biaya kirim 1 pesan).</p>
        <label style={{ fontSize: 13 }}>
          Jumlah rupiah
          <input type="number" min={2000} step={1000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={input} />
        </label>
        <button style={btn} onClick={() => void topup()} disabled={busy} aria-label="Topup saldo WhatsApp">
          Topup {amount.toLocaleString("id-ID")} Rp ({Math.floor(amount / st.rupiahPerCredit)} kredit)
        </button>
        {error && <p style={{ color: "#a33", fontSize: 13 }} role="alert">{error}</p>}
      </section>

      <section style={card}>
        <strong>Otomasi</strong>
        <label style={{ display: "block", fontSize: 14, marginBottom: 6 }}>
          <input type="checkbox" checked={autoDue} onChange={(e) => setAutoDue(e.target.checked)} />{" "}
          Ingatkan tagihan jatuh tempo ke pelanggan
        </label>
        <label style={{ display: "block", fontSize: 14, marginBottom: 6 }}>
          <input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} />{" "}
          Laporan harian ke pemilik usaha (jam 08.00)
        </label>
        <label style={{ fontSize: 13 }}>
          Nomor WhatsApp pemilik (format 62…)
          <input value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} style={input} placeholder="628123456789" />
        </label>
        <button style={btn} onClick={() => void saveSettings()} disabled={busy}>
          {saved ? "Tersimpan ✓" : "Simpan pengaturan"}
        </button>
      </section>

      <section style={card}>
        <strong>Riwayat pesan (20 terakhir)</strong>
        {st.recent.length === 0 && <p style={{ fontSize: 13, color: "#888" }}>Belum ada pesan.</p>}
        <ul style={{ listStyle: "none", padding: 0, fontSize: 13 }}>
          {st.recent.map((m) => (
            <li key={m.id} style={{ padding: "4px 0", borderBottom: "1px solid #eee" }}>
              <span style={{ color: m.status === "sent" ? "#3d6b54" : "#a33" }}>{m.status}</span> → {m.to}: {m.body.slice(0, 60)}
              {m.error && <span style={{ color: "#a33" }}> ({m.error})</span>}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
