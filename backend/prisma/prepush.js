const { PrismaClient } = require('@prisma/client');
async function main() {
  const p = new PrismaClient();
  // Delete all rows in reverse dependency order
  const tables = ['AttendanceEvent', 'SecurityEvent', 'AuditLog', 'CalendarOverride', 'Device', 'Student', 'Bus', 'Route'];
  for (const t of tables) {
    try { await p.$executeRawUnsafe(`DELETE FROM "${t}"`); } catch {}
  }
  await p.$disconnect();
}
main();
