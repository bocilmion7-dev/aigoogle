import { prisma } from "../../apps/api/src/db.js";
async function main() {
  const t = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!t) throw new Error("tidak ada tenant");
  const tid = t.id;
  // reset lastSent supaya kirim baru diproses
  await prisma.appSetting.deleteMany({ where: { key: { startsWith: `wa:webhook_last_sent:${tid}` } } });
  const before = await prisma.waMessageLog.count({ where: { tenantId: tid } });
  const K = process.env.ACCURATE_WEBHOOK_APP_KEY ?? "";
  const r = await fetch(`${process.env.APP_ORIGIN || "http://localhost:3001"}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-key": K },
    body: JSON.stringify({ event: "CUSTOMER", data: { id: 999, name: "Notif Uji 3" } }),
  });
  await new Promise((res) => setTimeout(res, 2000));
  const logs = await prisma.waMessageLog.findMany({ where: { tenantId: tid }, orderBy: { createdAt: "desc" }, take: 3 });
  console.log("push →", r.status, "| log baru:", logs.length - before, "|", logs[0]?.status, logs[0]?.error, "|", logs[0]?.body.slice(0, 70));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
