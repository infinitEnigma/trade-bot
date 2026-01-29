/** @format */

const Sequencer = require('@jest/test-sequencer').default;

class CustomSequencer extends Sequencer {
  sort(tests) {
    // Sort tests to run worker tests first (to identify issues early)
    // and database tests last (to avoid connection conflicts)
    const workerTests = tests.filter(test => 
      test.path.includes('workers.test.ts') || 
      test.path.includes('resilience.test.ts')
    );
    
    const otherTests = tests.filter(test => 
      !test.path.includes('workers.test.ts') && 
      !test.path.includes('resilience.test.ts') &&
      !test.path.includes('database.test.ts')
    );
    
    const databaseTests = tests.filter(test => 
      test.path.includes('database.test.ts')
    );

    // Run in order: worker tests -> other tests -> database tests
    return [...workerTests, ...otherTests, ...databaseTests];
  }
}

module.exports = CustomSequencer;