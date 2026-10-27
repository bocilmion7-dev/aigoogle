import { useEffect, useState } from "react";
import { AI_GATE_EVENT, type AiGateReason } from "./session-api";

/** Popup info akses AI: langganan/demo habis atau token habis. */
export function AiGate() {
  const [reason, setReason] = useState<AiGateReason | null>(null);

  useEffect(() => {
    const onGate = (e: Event) => {
      const detail = (e as CustomEvent<{ reason?: AiGateReason }>).detail;
      if (detail?.reason === "subscription" || detail?.reason === "token") setReason(detail.reason);
    };
    window.addEventListener(AI_GATE_EVENT, onGate);
    return () => window.removeEventListener(AI_GATE_EVENT, onGate);
  }, []);

  if (!reason) return null;
  const token = reason === "token";

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal ai-gate" role="alertdialog" aria-modal="true" aria-labelledby="ai-gate-title">
        <div className="modal__head">
          <strong className="card__title" id="ai-gate-title">
            {token ? "Token habis" : "Masa aktif berakhir"}
          </strong>
        </div>
        <p style={{ margin: 0 }}>
          {token
            ? "Saldo token Anda habis. Silakan top up token untuk melanjutkan menggunakan fitur AI."
            : "Masa demo/langganan AI sudah habis. Silakan pilih paket langganan untuk melanjutkan."}
        </p>
        <div className="modal__foot">
          <button
            type="button"
            className="btn"
            onClick={() => {
              window.location.href = token ? "/saldo" : "/subscription";
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
