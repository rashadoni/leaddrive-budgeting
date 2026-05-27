import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env") });
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const inds = await prisma.indicatorDefinition.findMany({
  where: { code: "LEGAL_MONEY_AT_RISK" },
  select: { id: true, code: true },
});
const cos = await prisma.company.findMany({
  where: { code: { startsWith: "AZSEKER-" }, isActive: true, level: 2 },
  select: { id: true, code: true },
});
let n = 0;
for (const co of cos) {
  for (const ind of inds) {
    await prisma.companyIndicator.upsert({
      where: { companyId_indicatorId: { companyId: co.id, indicatorId: ind.id } },
      update: { enabled: true },
      create: { companyId: co.id, indicatorId: ind.id, enabled: true },
    });
    n++;
  }
}
console.log(`✓ Enabled ${n} pairs`);
await prisma.$disconnect();
