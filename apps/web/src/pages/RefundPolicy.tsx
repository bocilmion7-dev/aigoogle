export function RefundPolicy() {
  return (
    <div className="app">
      <main className="page page--narrow">
        <h1>Kebijakan Refund &amp; Kredit</h1>
        <div className="card">
          <h2>Langganan</h2>
          <p>
            Langganan dapat dibatalkan kapan saja. Biaya bulan yang sudah dibayar tidak dikembalikan,
            tetapi langganan tetap aktif sampai akhir periode. Perpanjangan otomatis dapat dimatikan
            dari halaman Langganan.
          </p>
          <h2>Top up token AI / saldo WhatsApp</h2>
          <p>
            Saldo yang sudah masuk tidak dapat diuangkan kembali. Jika terjadi kegagalan layanan yang
            terbukti berasal dari sistem kami, kredit pengganti dapat diberikan setelah verifikasi.
          </p>
          <h2>Pembayaran ganda atau gagal</h2>
          <p>
            Pembayaran ganda akibat gangguan teknis akan dikembalikan penuh atau dikreditkan sesuai
            pilihan Anda. Hubungi support dengan menyertakan order ID dan bukti pembayaran.
          </p>
          <h2>Proses</h2>
          <p>
            Ajukan permintaan melalui menu Bantuan/WhatsApp resmi. Kami menanggapi dalam 2 hari kerja
            dan menyelesaikan refund yang disetujui dalam 7–14 hari kerja ke rekening asal.
          </p>
        </div>
        <a className="btn btn--ghost btn--sm" href="/subscription">← Kembali ke Langganan</a>
      </main>
    </div>
  );
}
