import assert from 'node:assert/strict';
import test from 'node:test';
import { hoursText, minutesText, triesLeftText } from '../lib/format';
import { inviteEmail, loginCodeEmail } from '../lib/mail';

test('counted nouns agree with the number and use Arabic-Indic digits', () => {
  assert.equal(minutesText(10), '١٠ دقائق');
  assert.equal(minutesText(1), 'دقيقة واحدة');
  assert.equal(minutesText(2), 'دقيقتين');
  assert.equal(minutesText(15), '١٥ دقيقة');
  assert.equal(hoursText(48), '٤٨ ساعة');
  assert.equal(hoursText(5), '٥ ساعات');
  assert.equal(triesLeftText(4), 'بقيت ٤ محاولات');
  assert.equal(triesLeftText(2), 'بقيت محاولتان');
  assert.equal(triesLeftText(1), 'بقيت محاولة واحدة');
  assert.equal(triesLeftText(0), 'لم تبقَ محاولات');
});

test('both e-mails say how long they last in Arabic digits, in the text and the HTML part', () => {
  const code = loginCodeEmail('123456', 10);
  assert.match(code.text, /ولمدة ١٠ دقائق/);
  assert.match(code.html, /ولمدة ١٠ دقائق/);
  assert.doesNotMatch(code.text + code.html, /\b10\b/);
  const invite = inviteEmail('https://example.test/admin/invite/x', 'admin', 48);
  assert.match(invite.text, /ولمدة ٤٨ ساعة/);
  assert.match(invite.html, /ولمدة ٤٨ ساعة/);
});
