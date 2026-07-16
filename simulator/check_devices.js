const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.device.findMany().then(d => {
  console.log(JSON.stringify(d, null, 2));
  p.$disconnect();
}).catch(e => {
  console.error(e.message);
  p.$disconnect();
});
