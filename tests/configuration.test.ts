import * as path from 'path';
import { SebLoader } from '../src/Configuration/SebLoader';
import { SebValidator } from '../src/Configuration/SebValidator';
import { DEFAULT_EXAM_CONFIGURATION } from '../src/Configuration/ExamConfiguration';

export function runConfigurationTests() {
  console.log('\n--- Running Configuration & Loader Tests ---');

  // Test 1: Load valid XML .seb file
  const validSebPath = path.join(__dirname, '../samples/valid-exam.seb');
  const validResult = SebLoader.loadFromFile(validSebPath);
  console.assert(validResult.success === true, 'Test 1.1 Failed: Valid .seb should load successfully');
  console.assert(validResult.configuration?.startUrl === 'https://example.edu/exam/session/4029', 'Test 1.2 Failed: Start URL mismatch');
  console.assert(validResult.configuration?.examTitle === 'Computer Science Midterm Examination', 'Test 1.3 Failed: Title mismatch');
  console.assert(validResult.configuration?.fullscreen === true, 'Test 1.4 Failed: Fullscreen mismatch');
  console.assert(validResult.configuration?.clipboard.copy === true, 'Test 1.5 Failed: Copy should be allowed');
  console.assert(validResult.configuration?.clipboard.paste === true, 'Test 1.6 Failed: Paste should be allowed');
  console.assert(validResult.configuration?.allowedUrls.length === 2, 'Test 1.7 Failed: Allowed URLs count mismatch');
  console.log('✔ Test 1: Valid XML .seb configuration loads and parses correctly');

  // Test 2: Load valid JSON config
  const validJsonPath = path.join(__dirname, '../samples/sample-exam.json');
  const jsonResult = SebLoader.loadFromFile(validJsonPath);
  console.assert(jsonResult.success === true, 'Test 2.1 Failed: JSON configuration should load successfully');
  console.assert(jsonResult.configuration?.startUrl === 'https://example.edu/exam/session/4029', 'Test 2.2 Failed: Start URL mismatch in JSON');
  console.log('✔ Test 2: Valid JSON configuration loads and parses correctly');

  // Test 3: Load invalid .seb file missing startURL
  const invalidSebPath = path.join(__dirname, '../samples/invalid-exam.seb');
  const invalidResult = SebLoader.loadFromFile(invalidSebPath);
  console.assert(invalidResult.success === false, 'Test 3.1 Failed: Invalid .seb should fail loading/validation');
  console.assert(invalidResult.error?.includes('start URL is missing'), 'Test 3.2 Failed: Error should mention missing start URL');
  console.log('✔ Test 3: Missing start URL correctly rejected with descriptive error');

  // Test 4: Rejection of encrypted .seb files
  const encryptedSebPath = path.join(__dirname, '../samples/encrypted-exam.seb');
  const encryptedResult = SebLoader.loadFromFile(encryptedSebPath);
  console.assert(encryptedResult.success === false, 'Test 4.1 Failed: Encrypted .seb should be cleanly rejected');
  console.assert(encryptedResult.error?.includes('encryption'), 'Test 4.2 Failed: Error should mention encryption');
  console.log('✔ Test 4: Encrypted .seb file rejected with clear instructional feedback');

  // Test 5: Non-existent file
  const missingResult = SebLoader.loadFromFile(path.join(__dirname, 'non-existent.seb'));
  console.assert(missingResult.success === false, 'Test 5.1 Failed: Missing file should fail');
  console.log('✔ Test 5: Non-existent file returns graceful error');

  // Test 6: Validator protocol checking
  const badProtocolConfig = {
    ...DEFAULT_EXAM_CONFIGURATION,
    startUrl: 'javascript:alert(1)',
  };
  const valResult = SebValidator.validate(badProtocolConfig);
  console.assert(valResult.isValid === false, 'Test 6.1 Failed: Insecure protocol should be rejected');
  console.log('✔ Test 6: Insecure or dangerous protocols rejected by validator');

  // Test 7: SEB protocol URL normalization
  const sebsUrl = 'sebs://exam.university.edu/quiz/seb.php';
  const normalizedHttps = SebLoader.normalizeSebUrl(sebsUrl);
  console.assert(normalizedHttps === 'https://exam.university.edu/quiz/seb.php', 'Test 7.1 Failed: sebs:// should normalize to https://');

  const sebUrl = 'seb://exam.university.edu/config.seb';
  const normalizedHttp = SebLoader.normalizeSebUrl(sebUrl);
  console.assert(normalizedHttp === 'http://exam.university.edu/config.seb', 'Test 7.2 Failed: seb:// should normalize to http://');
  console.log('✔ Test 7: Safe Exam Browser protocol URLs (seb:// and sebs://) correctly normalized');

  // Test 8: seb-config protocol URL normalization
  const sebConfigUrl = 'seb-config?seb_login_token=xyz123';
  const normalizedSebConfig = SebLoader.normalizeSebUrl(sebConfigUrl);
  console.assert(normalizedSebConfig.startsWith('https://'), 'Test 8.1 Failed: seb-config? should normalize to https://');
  console.assert(normalizedSebConfig.includes('seb_login_token=xyz123'), 'Test 8.2 Failed: Token should be preserved');
  console.log('✔ Test 8: seb-config protocol URL correctly normalized');

  // Test 9: Deterministic Config Key calculation matches SEB / Moodle spec
  const emptyKey = SebLoader.computeSebConfigKey({});
  console.assert(
    emptyKey === '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    `Test 9.1 Failed: Empty dict config key expected 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945, got ${emptyKey}`
  );
  console.log('✔ Test 9: Deterministic Config Key matches Moodle quizaccess_seb specification');
}

