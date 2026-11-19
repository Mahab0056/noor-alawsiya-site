import assert from 'node:assert/strict';
import test from 'node:test';
import { hoursText, minutesText, triesLeftText } from '../lib/format';
import { DEFAULT_MAIL_FROM, inviteEmail, loginCodeEmail, mailConfig } from '../lib/mail';

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

test('the default sender is the school by its Arabic name on the verified domain (decisions 44/45)', () => {
  assert.equal(DEFAULT_MAIL_FROM, 'نور الأوصياء <noreply@mail.noor-alawsiya.com>');
  const cfg = mailConfig({ RESEND_API_KEY: 're_test_12345678', APP_ORIGIN: 'https://noor-alawsiya.com' });
  assert.equal(cfg.from, DEFAULT_MAIL_FROM);
});
