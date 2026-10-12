import { prisma } from "../../apps/api/src/db.js";
async function main() {
  const rows = await prisma.accurateWebhookEvent.findMany({
    where: { payload: { contains: "uji-appkey" } },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { event: true, payload: true, createdAt: true },
  });
  for (const r of rows) {
    const p = JSON.parse(r.payload) as { _meta?: { appKey?: string; headers?: Record<string, unknown> } };
    console.log(r.event, r.createdAt.toISOString(), "appKey=", p._meta?.appKey, "headers=", Object.keys(p._meta?.headers ?? {}).slice(0, 6).join(","));
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
