import { execSync } from 'child_process';
/* eslint-disable no-console */
import { runConfigDoctor } from '../core/config/doctor';

console.log('🎓 Sage v0.1 Beta - Final Certification Gate\n');

const steps = [
  { name: 'Lint', cmd: 'npm run lint' },
  { name: 'Build', cmd: 'npm run build' },
  { name: 'Test', cmd: 'npm test' },
  { name: 'Prisma Validate', cmd: 'npx prisma validate' },
];

async function main() {
  let failed = false;

  // 1. Doctor Check
  console.log('--- Step 1: Doctor Check ---');
  try {
    await runConfigDoctor();
  } catch {
    console.error('❌ Doctor check failed');
    failed = true;
  }

  // 2. Build/Lint/Test Steps
  console.log('\n--- Step 2: Quality Gates ---');
  for (const step of steps) {
    try {
      console.log(`> Running ${step.name}...`);
      execSync(step.cmd, { stdio: 'inherit' });
      console.log(`✅ ${step.name} passed.`);
    } catch {
      console.error(`❌ ${step.name} failed.`);
      failed = true;
      // Break on first failure? Or run all? Let's run all to see full status.
    }
  }

  console.log('\n----------------------------------------');
  if (failed) {
    console.error('❌ CERTIFICATION FAILED. Fix issues and retry.');
    process.exit(1);
  } else {
    console.log('✅ CERTIFICATION PASSED. Ready for Release!');
    process.exit(0);
  }
}

main();
