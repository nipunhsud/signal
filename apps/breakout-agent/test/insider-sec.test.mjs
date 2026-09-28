// The SEC side: building the right URLs out of an accession number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filingUrl, humanUrl } from '../insider-sec.js';

test('the raw XML url drops the xsl rendering directory and the CIK leading zeros', () => {
  assert.equal(
    filingUrl('0001851112', '0001601099-26-000065', 'xslF345X06/wk-form4_1789675658.xml'),
    'https://www.sec.gov/Archives/edgar/data/1851112/000160109926000065/wk-form4_1789675658.xml',
  );
});

test('a primary document with no xsl prefix is used as it stands', () => {
  assert.equal(
    filingUrl('0000709283', '0001234567-26-000001', 'form4.xml'),
    'https://www.sec.gov/Archives/edgar/data/709283/000123456726000001/form4.xml',
  );
});

test('with no document named, the url is the filing directory', () => {
  assert.match(filingUrl('0000709283', '0001234567-26-000001', null), /000123456726000001\/$/);
});

test('the link a person opens is the EDGAR filing index, not the raw XML', () => {
  assert.equal(
    humanUrl('0001851112', '0001601099-26-000065'),
    'https://www.sec.gov/Archives/edgar/data/1851112/000160109926000065/0001601099-26-000065-index.htm',
  );
});
