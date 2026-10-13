import { prisma } from "../../apps/api/src/db.js";
import { sendWaText } from "../../apps/api/src/wa/service.js";
async function main() {
  const conn = await prisma.connection.findFirst({ where: { host: { contains: "accurate.id" } } });
  if (!conn) throw new Error("tidak ada tenant nyata");
  // nomor uji ≠ penerima sandbox → d360 harus membalas 403 (bukan 401 key salah)
  const r = await sendWaText(conn.tenantId, "6283148011309", "Uji koneksi 360dialog dari aigoogle");
  console.log("hasil:", JSON.stringify(r));
  const last = await prisma.waMessageLog.findFirst({ where: { tenantId: conn.tenantId }, orderBy: { createdAt: "desc" } });
  console.log("log:", last?.status, "|", (last?.error ?? "").slice(0, 120));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
