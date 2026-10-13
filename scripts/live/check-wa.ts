import { prisma } from "../../apps/api/src/db.js";
async function main() {
  const rows = await prisma.waMessageLog.findMany({ orderBy: { createdAt: "desc" }, take: 3, select: { to: true, body: true, status: true, error: true, createdAt: true } });
  for (const r of rows) console.log(r.status, "→", r.to, "|", r.body.slice(0, 50), r.error ? "| " + r.error.slice(0, 60) : "", "|", r.createdAt.toISOString());
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
