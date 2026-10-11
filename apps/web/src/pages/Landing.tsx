export function Landing() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 560, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 650, marginTop: 40 }}>AI Google untuk Accurate Online</h1>
      <p style={{ lineHeight: 1.6, color: "#444" }}>
        Add-on AI untuk akuntansi Accurate. Masuk lewat Accurate sekali — setelah itu gunakan email & password.
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <a href="/api/launch" style={{ color: "#3d6b54", fontWeight: 600 }}>Masuk lewat Accurate →</a>
        <a href="/login" style={{ color: "#3d6b54" }}>Masuk dengan password</a>
      </div>
      <p style={{ color: "#666", fontSize: 13, marginTop: 24 }}>
        Pertama kali dari Accurate, Anda akan diminta membuat password.
      </p>
    </main>
  );
}
