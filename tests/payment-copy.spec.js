const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scannedRoots = ['public', 'routes', 'docs', 'README.md'];
const bannedPaymentCopy = [
  /paymongo/i,
  /hitpay/i,
  /payment link/i,
  /generate gcash link/i,
  /regenerate payment link/i,
  /new payment link/i,
  /payment gateway issue/i,
  /failed online payment/i,
  /check online/i,
  /no online link/i
];

function collectFiles(targetPath) {
  const fullPath = path.join(root, targetPath);
  if (!fs.existsSync(fullPath)) return [];
  const stat = fs.statSync(fullPath);
  if (stat.isFile()) return [fullPath];

  return fs.readdirSync(fullPath).flatMap(entry => {
    const entryPath = path.join(fullPath, entry);
    const entryStat = fs.statSync(entryPath);
    if (entryStat.isDirectory()) return collectFiles(path.relative(root, entryPath));
    return entryPath;
  });
}

test('customer and admin copy does not expose removed payment gateway wording', () => {
  const files = scannedRoots
    .flatMap(collectFiles)
    .filter(file => /\.(html|js|css|md)$/.test(file));

  const matches = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of bannedPaymentCopy) {
      if (pattern.test(content)) {
        matches.push(`${path.relative(root, file)} -> ${pattern}`);
      }
    }
  }

  expect(matches).toEqual([]);
});
