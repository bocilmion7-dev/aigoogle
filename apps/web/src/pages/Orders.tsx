import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createBiteshipOrder,
  getMe,
  getOrderTracking,
  getOrders,
  getShippingSettings,
  putShippingSettings,
  runOrderAccurate,
  searchAccurateCustomers,
  searchShippingAreas,
  type AccurateCustomerRef,
  type OrderRow,
  type OrderTracking,
  type ShippingArea,
  type ShippingOrigin,
} from "../api";
import { AppHeader, PageLoader } from "../ui";
import { IconCheck, IconPackage, IconRefresh, IconSearch, IconSend } from "../icons";

const STAGES = [
  { key: "", label: "Semua" },
  { key: "menunggu", label: "Menunggu bayar" },
  { key: "lunas", label: "Lunas" },
  { key: "pesanan-acc", label: "SO Accurate" },
  { key: "difakturkan", label: "Difakturkan" },
  { key: "selesai", label: "Selesai" },
] as const;

const STAGE_LABEL: Record<string, string> = {
  menunggu: "Menunggu bayar",
  lunas: "Lunas",
  "pesanan-acc": "SO Accurate",
  difakturkan: "Difakturkan",
  selesai: "Selesai",
  gagal: "Gagal",
};

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function Orders() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [connected, setConnected] = useState(true);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [stage, setStage] = useState<string>("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<OrderRow | null>(null);
  const [busy, setBusy] = useState("");
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<AccurateCustomerRef[]>([]);
  const [newName, setNewName] = useState("");
  // pengiriman (Biteship)
  const [shipOpen, setShipOpen] = useState(false);
  const [origin, setOrigin] = useState<ShippingOrigin | null>(null);
  const [biteshipReady, setBiteshipReady] = useState(false);
  const [biteshipMode, setBiteshipMode] = useState<"off" | "test" | "live">("off");
  const [areaQ, setAreaQ] = useState("");
  const [areaResults, setAreaResults] = useState<ShippingArea[]>([]);
  const [shipBusy, setShipBusy] = useState("");
  const [tracking, setTracking] = useState<OrderTracking | null>(null);

  const load = useCallback(async (f: string, query: string) => {
    setLoading(true);
    try {
      const r = await getOrders({ status: f, q: query });
      setOrders(r.orders);
      setConnected(r.accurateConnected);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal memuat pesanan.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void getMe().then(setMe);
  }, []);

  useEffect(() => {
    void getShippingSettings()
      .then((r) => {
        setOrigin(r.origin);
        setBiteshipReady(r.biteshipReady);
        setBiteshipMode(r.biteshipMode);
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(stage, q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [load, stage, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: orders.length };
    for (const o of orders) c[o.stage] = (c[o.stage] ?? 0) + 1;
    return c;
  }, [orders]);

  function openOrder(o: OrderRow) {
    setOpen(o);
    setErr("");
    setMsg("");
    setTracking(null);
    setCustQuery(o.buyerPhone);
    setCustResults([]);
    setNewName(o.buyerName || "");
  }

  async function findArea() {
    setShipBusy("area");
    try {
      setAreaResults(await searchShippingAreas(areaQ.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal mencari kode pos.");
    } finally {
      setShipBusy("");
    }
  }

  async function saveOrigin() {
    if (!origin) return;
    setShipBusy("save");
    setErr("");
    try {
      const r = await putShippingSettings(origin);
      setOrigin(r.origin);
      setBiteshipReady(r.biteshipReady);
      setBiteshipMode(r.biteshipMode);
      setMsg("Pengaturan pengiriman disimpan.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan pengaturan pengiriman.");
    } finally {
      setShipBusy("");
    }
  }

  async function shipToBiteship() {
    if (!open) return;
    setShipBusy("ship");
    setErr("");
    setMsg("");
    try {
      const r = await createBiteshipOrder(open.orderId);
      if (r.order) setOpen(r.order);
      setMsg(
        r.shipment.waybillId
          ? `Order Biteship dibuat — resi ${r.shipment.waybillId}.`
          : `Order Biteship dibuat (${r.shipment.id}). Resi menyusul dari kurir.`
      );
      await load(stage, q.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal input ke Biteship.");
    } finally {
      setShipBusy("");
    }
  }

  async function loadTracking() {
    if (!open) return;
    setShipBusy("track");
    setErr("");
    try {
      const r = await getOrderTracking(open.orderId);
      setTracking(r.tracking);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal melacak paket.");
    } finally {
      setShipBusy("");
    }
  }

  async function act(doc: "customer" | "sales-order" | "sales-invoice" | "sales-receipt" | "close-order" | "retry", extra?: { customerNo?: string; customerName?: string }) {
    if (!open) return;
    setBusy(doc);
    setErr("");
    setMsg("");
    try {
      const r = await runOrderAccurate(open.orderId, {
        doc,
        ...extra,
        ...(doc === "customer" ? { customerName: extra?.customerName ?? newName.trim() } : {}),
      });
      if (r.order) setOpen(r.order);
      setMsg(
        doc === "sales-order"
          ? "Pesanan penjualan dibuat di Accurate."
          : doc === "sales-invoice"
            ? "Faktur penjualan dibuat di Accurate."
            : doc === "sales-receipt"
              ? "Penerimaan kas dicatat di Accurate."
              : doc === "close-order"
                ? "Pesanan penjualan ditutup."
                : doc === "retry"
                  ? "Sinkron Accurate diulang."
                  : "Pelanggan Accurate tertaut."
      );
      await load(stage, q.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Aksi Accurate gagal.");
    } finally {
      setBusy("");
    }
  }

  async function findCustomer() {
    setBusy("find");
    setErr("");
    try {
      setCustResults(await searchAccurateCustomers(custQuery.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal mencari pelanggan.");
    } finally {
      setBusy("");
    }
  }

  if (me === undefined) {
    return (
      <div className="app">
        <main className="page page--narrow">
          <PageLoader />
        </main>
      </div>
    );
  }
  if (me === null) {
    window.location.href = "/login";
    return null;
  }

  const a = open?.accurate;
  const canManage = !!me.permissions?.includes("app:users.manage");
  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page page--narrow orders">
        <header className="orders-head">
          <div>
            <h1 className="orders-title">Pesanan</h1>
            <p className="meta" style={{ margin: 0 }}>
              Pesanan masuk dari WhatsApp · tersambung ke Accurate
            </p>
          </div>
          <div className="orders-head__actions">
            {canManage && (
              <button type="button" className="btn btn--2 btn--sm" onClick={() => setShipOpen(true)}>
                <IconPackage size={15} /> Pengaturan pengiriman
              </button>
            )}
            <button
              type="button"
              className="btn btn--2 btn--sm"
              onClick={() => void load(stage, q.trim())}
              disabled={loading}
              aria-busy={loading}
            >
              <IconRefresh size={15} /> Muat ulang
            </button>
          </div>
        </header>

        {!connected && (
          <p className="banner banner--err" role="status">
            Accurate belum terhubung untuk perusahaan ini — buka Dashboard lalu hubungkan akun Accurate.
          </p>
        )}

        <div className="orders-filters" role="tablist" aria-label="Filter status pesanan">
          {STAGES.map((s) => (
            <button
              key={s.key || "all"}
              type="button"
              role="tab"
              aria-selected={stage === s.key}
              className={`orders-chip${stage === s.key ? " is-active" : ""}`}
              onClick={() => setStage(s.key)}
            >
              {s.label}
              {s.key && counts[s.key] ? <span className="orders-chip__count">{counts[s.key]}</span> : null}
            </button>
          ))}
        </div>

        <div className="orders-search">
          <IconSearch size={16} />
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama, nomor HP, atau ID pesanan…"
            aria-label="Cari pesanan"
          />
        </div>

        {err && !open && (
          <p className="banner banner--err" role="alert">
            {err}
          </p>
        )}

        {loading && orders.length === 0 ? (
          <PageLoader />
        ) : orders.length === 0 ? (
          <div className="card orders-empty">
            <IconPackage size={28} />
            <strong>Belum ada pesanan</strong>
            <p className="meta" style={{ margin: 0 }}>
              Pesanan dibuat otomatis oleh AI penjaga toko saat pembeli memesan lewat WhatsApp.
            </p>
          </div>
        ) : (
          <ul className="orders-list" role="list">
            {orders.map((o) => (
              <li key={o.orderId}>
                <button type="button" className="orders-card" onClick={() => openOrder(o)}>
                  <span className="orders-card__top">
                    <strong>{o.buyerName || `Pembeli ${o.buyerPhone}`}</strong>
                    <span className={`orders-badge is-${o.stage}`}>{STAGE_LABEL[o.stage] ?? o.stage}</span>
                  </span>
                  <span className="orders-card__items">
                    {o.items.map((i) => `${i.name} ×${i.qty}`).join(", ")}
                  </span>
                  <span className="orders-card__meta">
                    <span className="orders-card__total">{rp(o.total)}</span>
                    <span className="meta">
                      {when(o.createdAt)} · {o.orderId.replace("shop-", "")}
                    </span>
                  </span>
                  <span className="meta">
                    {o.fulfillment === "courier"
                      ? `Kurir ${o.shipping?.courierName ?? ""} ${o.shipping?.serviceName ?? ""} · ongkir ${rp(
                          o.shipping?.price ?? 0
                        )}`
                      : "Ambil sendiri di toko"}
                  </span>
                  {o.accurate?.lastError && (
                    <span className="orders-card__warn">Accurate: {o.accurate.lastError}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(null)}>
          <div
            className="modal modal--qr modal--order"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__head">
              <IconPackage size={18} />
              <strong className="card__title" id="order-title">
                {open.buyerName || "Pesanan WhatsApp"}
              </strong>
              <button type="button" className="modal__x" onClick={() => setOpen(null)} aria-label="Tutup pesanan">
                ×
              </button>
            </div>

            {err && (
              <p className="banner banner--err" role="alert">
                {err}
              </p>
            )}
            {msg && (
              <p className="banner banner--ok" role="status">
                {msg}
              </p>
            )}

            <div className="orders-detail">
              <p className="meta" style={{ margin: 0 }}>
                {open.orderId} · {when(open.createdAt)} · <span className={`orders-badge is-${open.stage}`}>{STAGE_LABEL[open.stage] ?? open.stage}</span>
              </p>
              <section className="orders-acc" aria-label="Data pembeli">
                <h2 className="orders-acc__title">Pembeli</h2>
                <div className="orders-acc__row">
                  <span>Nama</span>
                  <span>{open.buyerName || "-"}</span>
                </div>
                <div className="orders-acc__row">
                  <span>No. HP</span>
                  <span>{open.buyerContactPhone || open.buyerPhone || "-"}</span>
                </div>
              </section>
              <table className="orders-items">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="num">
                      Qty
                    </th>
                    <th scope="col" className="num">
                      Harga
                    </th>
                    <th scope="col" className="num">
                      Subtotal
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {open.items.map((i) => (
                    <tr key={`${i.no}-${i.name}`}>
                      <td>
                        {i.name}
                        {i.no ? <span className="meta"> · {i.no}</span> : null}
                      </td>
                      <td className="num">{i.qty}</td>
                      <td className="num">{rp(i.price)}</td>
                      <td className="num">{rp(i.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={3}>
                      Subtotal barang
                    </th>
                    <td className="num">
                      {rp(
                        open.itemsSubtotal ??
                          open.items.reduce((s, i) => s + i.subtotal, 0)
                      )}
                    </td>
                  </tr>
                  {open.fulfillment === "courier" && open.shipping && (
                    <tr>
                      <th scope="row" colSpan={3}>
                        Ongkir ({[open.shipping.courierName, open.shipping.serviceName].filter(Boolean).join(" ") || "kurir"})
                      </th>
                      <td className="num">{rp(open.shipping.price ?? 0)}</td>
                    </tr>
                  )}
                  <tr>
                    <th scope="row" colSpan={3}>
                      Total
                    </th>
                    <td className="num">
                      <strong>{rp(open.total)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>

              <section className="orders-acc" aria-label="Pengiriman">
                <h2 className="orders-acc__title">Pengiriman</h2>
                {open.fulfillment === "courier" ? (
                  <>
                    <div className="orders-acc__row">
                      <span>Alamat</span>
                      <span>
                        {open.shipping?.destinationAddress || "-"}
                        {open.shipping?.destinationPostalCode ? ` (${open.shipping.destinationPostalCode})` : ""}
                      </span>
                    </div>
                    <div className="orders-acc__row">
                      <span>Kurir</span>
                      <span>
                        {open.shipping?.courierName} {open.shipping?.serviceName} · {rp(open.shipping?.price ?? 0)}
                        {open.shipping?.duration ? ` · ${open.shipping.duration}` : ""}
                      </span>
                    </div>
                    <div className="orders-acc__row">
                      <span>Berat</span>
                      <span>{open.shipping?.weightGram ?? 0} g</span>
                    </div>
                    <div className="orders-acc__row">
                      <span>Resi</span>
                      <span>
                        {open.shipping?.waybillId
                          ? open.shipping.waybillId
                          : open.shipping?.biteshipOrderId
                            ? `Biteship ${open.shipping.biteshipOrderId}`
                            : "belum"}
                      </span>
                    </div>
                    {open.shipping?.trackingLink && (
                      <div className="orders-acc__row">
                        <span>Link lacak</span>
                        <a href={open.shipping.trackingLink} target="_blank" rel="noopener noreferrer">
                          Buka halaman pelacakan
                        </a>
                      </div>
                    )}
                    {open.shipping?.status && (
                      <div className="orders-acc__row">
                        <span>Status kirim</span>
                        <span>{open.shipping.status}</span>
                      </div>
                    )}
                    {open.shipping?.biteshipOrderId && (
                      <p className="meta" style={{ margin: 0 }}>
                        Resi &amp; link pelacakan dikirim otomatis ke WhatsApp pembeli saat paket dijemput kurir.
                      </p>
                    )}
                    <div className="orders-actions">
                      {open.status === "paid" && !open.shipping?.biteshipOrderId && (
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={() => void shipToBiteship()}
                          disabled={shipBusy !== ""}
                        >
                          {shipBusy === "ship" ? <span className="spinner" aria-hidden="true" /> : <IconSend size={15} />}
                          Input ke Biteship
                        </button>
                      )}
                      {open.shipping?.waybillId && (
                        <button
                          type="button"
                          className="btn btn--2 btn--sm"
                          onClick={() => void loadTracking()}
                          disabled={shipBusy !== ""}
                        >
                          {shipBusy === "track" ? <span className="spinner" aria-hidden="true" /> : <IconRefresh size={15} />}
                          Lacak Paket
                        </button>
                      )}
                    </div>
                    {tracking && (
                      <ol className="orders-track">
                        {tracking.history.length === 0 && <li className="meta">Belum ada riwayat pelacakan.</li>}
                        {tracking.history
                          .slice()
                          .reverse()
                          .map((h, i) => (
                            <li key={`${h.updatedAt}-${i}`}>
                              <strong>{h.note}</strong>
                              <span className="meta">
                                {h.status}
                                {h.updatedAt ? ` · ${new Date(h.updatedAt).toLocaleString("id-ID")}` : ""}
                              </span>
                            </li>
                          ))}
                      </ol>
                    )}
                  </>
                ) : (
                  <p className="meta" style={{ margin: 0 }}>
                    Ambil sendiri di toko.
                  </p>
                )}
              </section>

              <section className="orders-acc" aria-label="Dokumen Accurate">
                <h2 className="orders-acc__title">Accurate</h2>
                <div className="orders-acc__row">
                  <span>Pelanggan</span>
                  <span>
                    {a?.customerNo ? (
                      <strong>
                        {a.customerName || a.customerNo} <span className="meta">({a.customerNo})</span>
                      </strong>
                    ) : (
                      <span className="meta">belum ditautkan</span>
                    )}
                  </span>
                </div>
                {!a?.customerNo && (
                  <div className="orders-cust">
                    <input
                      className="input"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Nama pelanggan di Accurate (untuk dibuat baru)"
                      aria-label="Nama pelanggan Accurate"
                    />
                    <button
                      type="button"
                      className="btn btn--2 btn--sm"
                      onClick={() => void act("customer", { customerName: newName.trim() })}
                      disabled={busy !== "" || !newName.trim()}
                    >
                      {busy === "customer" ? <span className="spinner" aria-hidden="true" /> : <IconCheck size={15} />}
                      Cari / buat
                    </button>
                    <div className="orders-search orders-search--sm">
                      <IconSearch size={15} />
                      <input
                        className="input"
                        value={custQuery}
                        onChange={(e) => setCustQuery(e.target.value)}
                        placeholder="Cari pelanggan Accurate (nama/no. HP)"
                        aria-label="Cari pelanggan Accurate"
                      />
                      <button
                        type="button"
                        className="btn btn--2 btn--sm"
                        onClick={() => void findCustomer()}
                        disabled={busy !== "" || !custQuery.trim()}
                      >
                        Cari
                      </button>
                    </div>
                    {custResults.length > 0 && (
                      <ul className="orders-cust__list" role="list">
                        {custResults.map((c) => (
                          <li key={c.customerNo}>
                            <button
                              type="button"
                              className="orders-cust__pick"
                              onClick={() =>
                                void act("customer", { customerNo: c.customerNo, customerName: c.name })
                              }
                            >
                              {c.name}
                              <span className="meta">
                                {c.customerNo}
                                {c.mobilePhone ? ` · ${c.mobilePhone}` : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="orders-acc__row">
                  <span>Pesanan (SO)</span>
                  <span>{a?.salesOrder ? <strong>{a.salesOrder.number}</strong> : <span className="meta">belum</span>}</span>
                </div>
                <div className="orders-acc__row">
                  <span>Faktur</span>
                  <span>{a?.salesInvoice ? <strong>{a.salesInvoice.number}</strong> : <span className="meta">belum</span>}</span>
                </div>
                <div className="orders-acc__row">
                  <span>Penerimaan kas</span>
                  <span>{a?.salesReceipt ? <strong>{a.salesReceipt.number}</strong> : <span className="meta">belum</span>}</span>
                </div>

                {a?.lastError && (
                  <p className="banner banner--err" role="status" style={{ margin: "var(--space-xs) 0 0" }}>
                    {a.lastError}
                  </p>
                )}
              </section>
            </div>

            <div className="orders-actions">
              {!open.accurate?.salesOrder && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => void act("sales-order")}
                  disabled={busy !== ""}
                >
                  {busy === "sales-order" ? <span className="spinner" aria-hidden="true" /> : <IconSend size={15} />}
                  Input Pesanan (SO)
                </button>
              )}
              {open.status === "paid" && !open.accurate?.salesInvoice && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => void act("sales-invoice")}
                  disabled={busy !== ""}
                >
                  {busy === "sales-invoice" ? <span className="spinner" aria-hidden="true" /> : <IconPackage size={15} />}
                  Buat Faktur
                </button>
              )}
              {open.accurate?.salesInvoice && !open.accurate?.salesReceipt && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => void act("sales-receipt")}
                  disabled={busy !== ""}
                >
                  {busy === "sales-receipt" ? <span className="spinner" aria-hidden="true" /> : <IconCheck size={15} />}
                  Catat Penerimaan Kas
                </button>
              )}
              {open.accurate?.salesOrder && (
                <button
                  type="button"
                  className="btn btn--2 btn--sm"
                  onClick={() => void act("close-order")}
                  disabled={busy !== ""}
                >
                  Tutup Pesanan
                </button>
              )}
              {open.accurate?.lastError && (
                <button
                  type="button"
                  className="btn btn--2 btn--sm"
                  onClick={() => void act("retry")}
                  disabled={busy !== "" || open.status !== "paid"}
                >
                  <IconRefresh size={15} /> Ulangi sinkron
                </button>
              )}
            </div>

            <div className="modal__foot">
              <button type="button" className="btn btn--2" onClick={() => setOpen(null)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {shipOpen && origin && (
        <div className="modal-overlay" onClick={() => setShipOpen(false)}>
          <div
            className="modal modal--qr"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ship-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__head">
              <IconPackage size={18} />
              <strong className="card__title" id="ship-title">
                Asal Pengiriman
              </strong>
              <button type="button" className="modal__x" onClick={() => setShipOpen(false)} aria-label="Tutup pengaturan pengiriman">
                ×
              </button>
            </div>
            {!biteshipReady && (
              <p className="banner banner--err" role="status">
                BITESHIP_API_KEY belum diatur — cek ongkir & order kurir tidak aktif.
              </p>
            )}
            {biteshipReady && (
              <p className="meta" style={{ margin: 0 }}>
                Mode key Biteship:{" "}
                <strong>{biteshipMode === "test" ? "Sandbox (biteship_test)" : "Live (biteship_live)"}</strong>
                {biteshipMode === "live" && " — Order API harus sudah diaktivasi di dashboard Biteship."}
              </p>
            )}
            {err && <p className="banner banner--err" role="alert">{err}</p>}
            {msg && <p className="banner banner--ok" role="status">{msg}</p>}
            <div className="orders-acc">
              <label className="orders-field">
                <span>Nama kontak</span>
                <input
                  className="input"
                  value={origin.contactName}
                  onChange={(e) => setOrigin({ ...origin, contactName: e.target.value })}
                  placeholder="Nama penanggung jawab gudang"
                />
              </label>
              <label className="orders-field">
                <span>No. HP</span>
                <input
                  className="input"
                  value={origin.phone}
                  onChange={(e) => setOrigin({ ...origin, phone: e.target.value })}
                  placeholder="08xxxxxxxxxx"
                  inputMode="tel"
                />
              </label>
              <label className="orders-field">
                <span>Nama toko/organisasi</span>
                <input
                  className="input"
                  value={origin.organization}
                  onChange={(e) => setOrigin({ ...origin, organization: e.target.value })}
                  placeholder="Nama toko"
                />
              </label>
              <label className="orders-field">
                <span>Alamat lengkap gudang</span>
                <textarea
                  className="input"
                  rows={2}
                  value={origin.address}
                  onChange={(e) => setOrigin({ ...origin, address: e.target.value })}
                  placeholder="Jalan, nomor, kelurahan, kecamatan, kota"
                />
              </label>
              <label className="orders-field">
                <span>Kode pos</span>
                <input
                  className="input"
                  value={origin.postalCode}
                  onChange={(e) => setOrigin({ ...origin, postalCode: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                  placeholder="5 digit"
                  inputMode="numeric"
                />
              </label>
              <div className="orders-search orders-search--sm">
                <IconSearch size={15} />
                <input
                  className="input"
                  value={areaQ}
                  onChange={(e) => setAreaQ(e.target.value)}
                  placeholder="Cari kecamatan / kode pos"
                  aria-label="Cari area Biteship"
                />
                <button
                  type="button"
                  className="btn btn--2 btn--sm"
                  onClick={() => void findArea()}
                  disabled={shipBusy !== "" || !areaQ.trim()}
                >
                  Cari
                </button>
              </div>
              {areaResults.length > 0 && (
                <ul className="orders-cust__list" role="list">
                  {areaResults.map((ar) => (
                    <li key={ar.id}>
                      <button
                        type="button"
                        className="orders-cust__pick"
                        onClick={() => setOrigin({ ...origin, postalCode: ar.postalCode })}
                      >
                        {ar.name}
                        <span className="meta">{ar.postalCode}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="orders-actions">
              <button type="button" className="btn btn--sm" onClick={() => void saveOrigin()} disabled={shipBusy !== ""}>
                {shipBusy === "save" ? <span className="spinner" aria-hidden="true" /> : <IconCheck size={15} />}
                Simpan
              </button>
            </div>
            <div className="modal__foot">
              <button type="button" className="btn btn--2" onClick={() => setShipOpen(false)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
