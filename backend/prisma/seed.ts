import * as fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

function loadSecret(name: string): string {
  const fileVar = `${name}_FILE`;
  const filePath = process.env[fileVar];
  if (filePath) {
    try { return fs.readFileSync(filePath, 'utf8').trim(); } catch {}
  }
  return process.env[name] || '';
}

async function main() {
  const prisma = new PrismaClient();

  const phone = process.env.ADMIN_PHONE || '+977-9800000000';
  const password = loadSecret('ADMIN_PASSWORD') || 'change_me_in_production';
  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(password, salt);

  await prisma.adminUser.upsert({
    where: { phone },
    update: { passwordHash },
    create: { phone, passwordHash },
  });

  console.log(`Admin user created: ${phone}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
