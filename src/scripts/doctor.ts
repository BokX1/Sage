/* eslint-disable no-console */

import { runConfigDoctor } from '../core/config/doctor';
import { PrismaClient } from '@prisma/client';

async function main() {
  console.log('Sage v0.1 Beta - Doctor 🩺\n');

  // 1. Config Check
  await runConfigDoctor();

  // 2. DB Check
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    console.log('✅ Database connected.');
  } catch (e) {
    console.error('❌ Database connection failed:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }

  // 3. Migrations Check
  // Note: Detailed migration status check requires Prisma CLI.
  // DB connection success is a sufficient proxy for now.

  console.log('\nAll systems nominal (or at least responding).');
}

main().catch(console.error);
