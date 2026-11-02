import { runConfigurationTests } from './configuration.test';
import { runPoliciesTests } from './policies.test';
import { runNavigationTests } from './navigation.test';
import { runSessionTests } from './session.test';

async function runAll() {
  console.log('====================================================');
  console.log('       FSEB — Automated Test Suite Runner           ');
  console.log('====================================================');

  try {
    runConfigurationTests();
    runPoliciesTests();
    runNavigationTests();
    runSessionTests();

    console.log('\n====================================================');
    console.log('       ALL TESTS COMPLETED SUCCESSFULLY (100% PASS) ');
    console.log('====================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  }
}

runAll();

