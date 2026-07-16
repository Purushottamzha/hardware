const fs = require('node:fs');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

function loadSecret(name) {
  const fileVar = name + '_FILE';
  const filePath = process.env[fileVar];
  if (filePath) {
    try { return fs.readFileSync(filePath, 'utf8').trim(); } catch {}
  }
  return process.env[name] || '';
}

function generateToken(studentId, name, tokenVersion) {
  const secret = process.env.STUDENT_TOKEN_SECRET || loadSecret('STUDENT_TOKEN_SECRET') || 'dev-secret';
  const payload = JSON.stringify({ studentId, name, issuedAt: Date.now(), tokenVersion });
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const token = Buffer.from(JSON.stringify({ payload, hmac })).toString('base64');
  return { token, qrData: token };
}

// Distance from point to line segment (haversine approximation)
function distToSegment(lat1, lon1, lat2, lon2, plat, plon) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const d13 = R * Math.acos(Math.sin(toRad(lat1)) * Math.sin(toRad(plat)) + Math.cos(toRad(lat1)) * Math.cos(toRad(plat)) * Math.cos(toRad(plon - lon1)));
  const d23 = R * Math.acos(Math.sin(toRad(lat2)) * Math.sin(toRad(plat)) + Math.cos(toRad(lat2)) * Math.cos(toRad(plat)) * Math.cos(toRad(plon - lon2)));
  const d12 = R * Math.acos(Math.sin(toRad(lat1)) * Math.sin(toRad(lat2)) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1)));
  if (Math.abs(d12) < 1) return Math.min(d13, d23);
  const t = ((plat - lat1) * (lat2 - lat1) + (plon - lon1) * (lon2 - lon1)) / (d12 * d12 * R * R);
  if (t < 0) return d13;
  if (t > 1) return d23;
  const projLat = lat1 + t * (lat2 - lat1);
  const projLon = lon1 + t * (lon2 - lon1);
  return R * Math.acos(Math.sin(toRad(projLat)) * Math.sin(toRad(plat)) + Math.cos(toRad(projLat)) * Math.cos(toRad(plat)) * Math.cos(toRad(plon - projLon)));
}

function projectOntoRoute(point, waypoints) {
  let minDist = Infinity;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const dist = distToSegment(waypoints[i].lat, waypoints[i].lon, waypoints[i + 1].lat, waypoints[i + 1].lon, point.lat, point.lon);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

const ROUTES = [
  {
    id: 'route-gausala-balkumari',
    name: 'Gausala – Koteshwor – Balkumari',
    waypoints: [
      { lat: 27.7096, lon: 85.3382 },
      { lat: 27.6788, lon: 85.3487 },
      { lat: 27.6741, lon: 85.3392 },
    ],
  },
  {
    id: 'route-balkhu-balkumari',
    name: 'Balkhu – Gwarko – Balkumari',
    waypoints: [
      { lat: 27.6889, lon: 85.2952 },
      { lat: 27.6693, lon: 85.3271 },
      { lat: 27.6741, lon: 85.3392 },
    ],
  },
];

const BUSES = [
  { id: 'bus-01', routeId: 'route-gausala-balkumari' },
  { id: 'bus-02', routeId: 'route-balkhu-balkumari' },
];

const BUS1_STUDENTS = [
  { name: 'Sujan Shrestha', class: 'Grade 3 A', homeLat: 27.7080, homeLon: 85.3390, wardTole: 'Ward 32, Gausala', guardianName: 'Ram Shrestha' },
  { name: 'Anisha Maharjan', class: 'Grade 5 B', homeLat: 27.7042, homeLon: 85.3405, wardTole: 'Ward 31, Chabahil', guardianName: 'Krishna Maharjan' },
  { name: 'Bibek Tamang', class: 'Grade 2 A', homeLat: 27.6995, homeLon: 85.3421, wardTole: 'Ward 31, Chabahil', guardianName: 'Pemba Tamang' },
  { name: 'Prakriti Gurung', class: 'Grade 7 A', homeLat: 27.6940, homeLon: 85.3440, wardTole: 'Ward 33, Naya Bazar', guardianName: 'Dhan Gurung' },
  { name: 'Nabin Rai', class: 'Grade 4 B', homeLat: 27.6890, homeLon: 85.3458, wardTole: 'Ward 33, Naya Bazar', guardianName: 'Kumar Rai' },
  { name: 'Sabina Thapa', class: 'Grade 6 A', homeLat: 27.6835, homeLon: 85.3475, wardTole: 'Ward 35, Koteshwor', guardianName: 'Bishnu Thapa' },
  { name: 'Rohan Karki', class: 'Grade 1 B', homeLat: 27.6800, homeLon: 85.3480, wardTole: 'Ward 35, Koteshwor', guardianName: 'Mohan Karki' },
  { name: 'Manisha Basnet', class: 'Grade 8 A', homeLat: 27.6775, homeLon: 85.3450, wardTole: 'Ward 10, Old Baneshwor', guardianName: 'Raju Basnet' },
  { name: 'Aarav Adhikari', class: 'Grade 3 B', homeLat: 27.6758, homeLon: 85.3415, wardTole: 'Ward 10, Old Baneshwor', guardianName: 'Suman Adhikari' },
  { name: 'Sneha Lama', class: 'Grade 9 A', homeLat: 27.6748, homeLon: 85.3400, wardTole: 'Ward 9, Tinkune', guardianName: 'Tenzin Lama' },
];

const BUS2_STUDENTS = [
  { name: 'Sandip Magar', class: 'Grade 5 A', homeLat: 27.6885, homeLon: 85.2960, wardTole: 'Ward 14, Balkhu', guardianName: 'Mangal Magar' },
  { name: 'Kripa Shakya', class: 'Grade 9 B', homeLat: 27.6860, homeLon: 85.3010, wardTole: 'Ward 14, Balkhu', guardianName: 'Rajesh Shakya' },
  { name: 'Bishal Lama', class: 'Grade 2 B', homeLat: 27.6820, homeLon: 85.3070, wardTole: 'Ward 13, Kuleshwor', guardianName: 'Dawa Lama' },
  { name: 'Nisha Rana', class: 'Grade 6 B', homeLat: 27.6780, homeLon: 85.3130, wardTole: 'Ward 13, Kuleshwor', guardianName: 'Surendra Rana' },
  { name: 'Suraj Bhandari', class: 'Grade 4 A', homeLat: 27.6740, homeLon: 85.3180, wardTole: 'Ward 12, Kalimati', guardianName: 'Hari Bhandari' },
  { name: 'Alisha Khadka', class: 'Grade 7 B', homeLat: 27.6710, homeLon: 85.3230, wardTole: 'Ward 15, Gwarko', guardianName: 'Shyam Khadka' },
  { name: 'Diwash Neupane', class: 'Grade 3 A', homeLat: 27.6698, homeLon: 85.3280, wardTole: 'Ward 15, Gwarko', guardianName: 'Prakash Neupane' },
  { name: 'Sarita Bhattarai', class: 'Grade 10 A', homeLat: 27.6710, homeLon: 85.3320, wardTole: 'Ward 15, Gwarko', guardianName: 'Keshav Bhattarai' },
  { name: 'Kiran Gharti', class: 'Grade 1 A', homeLat: 27.6725, homeLon: 85.3355, wardTole: 'Ward 9, Tinkune', guardianName: 'Laxman Gharti' },
  { name: 'Anjali Sunar', class: 'Grade 8 B', homeLat: 27.6735, homeLon: 85.3380, wardTole: 'Ward 9, Tinkune', guardianName: 'Bhim Sunar' },
];

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
  console.log('Admin user created: ' + phone);

  for (const r of ROUTES) {
    await prisma.route.upsert({
      where: { id: r.id },
      update: { name: r.name, waypoints: r.waypoints },
      create: { id: r.id, name: r.name, waypoints: r.waypoints },
    });
  }
  console.log('Routes created: ' + ROUTES.map(r => r.id).join(', '));

  for (const b of BUSES) {
    await prisma.bus.upsert({
      where: { id: b.id },
      update: { routeId: b.routeId },
      create: { id: b.id, routeId: b.routeId },
    });
  }
  console.log('Buses created: ' + BUSES.map(b => b.id).join(', '));

  for (const s of BUS1_STUDENTS) {
    await prisma.student.create({
      data: { ...s, busId: 'bus-01', guardianPhone: null, homeRadiusM: 150, currentState: 'NOT_BOARDED', qrRevoked: false, tokenVersion: 1 },
    });
  }

  for (const s of BUS2_STUDENTS) {
    await prisma.student.create({
      data: { ...s, busId: 'bus-02', guardianPhone: null, homeRadiusM: 150, currentState: 'NOT_BOARDED', qrRevoked: false, tokenVersion: 1 },
    });
  }
  console.log('20 students created');

  const allStudents = await prisma.student.findMany();
  for (const s of allStudents) {
    generateToken(s.id, s.name, s.tokenVersion);
  }
  console.log('QR tokens generated for ' + allStudents.length + ' students');

  for (const bus of BUSES) {
    const busData = await prisma.bus.findUnique({
      where: { id: bus.id },
      include: { route: true, students: { where: { homeLat: { not: null }, homeLon: { not: null } } } },
    });
    if (!busData || !busData.route) continue;
    const waypoints = busData.route.waypoints;
    if (!waypoints || waypoints.length < 2) continue;

    const ranked = busData.students
      .map(s => ({ id: s.id, dist: projectOntoRoute({ lat: s.homeLat, lon: s.homeLon }, waypoints) }))
      .sort((a, b) => a.dist - b.dist);

    for (let i = 0; i < ranked.length; i++) {
      await prisma.student.update({
        where: { id: ranked[i].id },
        data: { routeOrder: i + 1 },
      });
    }
    console.log('routeOrder computed for bus ' + bus.id + ': ' + ranked.length + ' students');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
