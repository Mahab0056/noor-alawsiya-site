// Header link for a signed-in student (lane awsiya-signed-in-nav, 21/11/2026): «حسابي» instead of «دخول الطلاب».
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SESSION_COOKIE } from '../lib/cookie-names';
import { hasStudentCookie } from '../lib/student-nav';

function store(values: Record<string, string>) {
  return { get: (name: string) => (name in values ? { name, value: values[name] } : undefined) };
}

test('only a non-empty student session cookie counts as signed in', () => {
  assert.equal(hasStudentCookie(store({ [SESSION_COOKIE.student]: 'a-token' })), true);
  assert.equal(hasStudentCookie(store({})), false);
  assert.equal(hasStudentCookie(store({ [SESSION_COOKIE.student]: '' })), false);
  // An admin session is not a student session.
  assert.equal(hasStudentCookie(store({ [SESSION_COOKIE.admin]: 'a-token' })), false);
});

test('the header streams the student link and keeps the login link as the fallback', () => {
  const chrome = readFileSync('components/SiteChrome.tsx', 'utf8');
  assert.match(chrome, /<StudentNavLink \/>/);
  const nav = chrome.slice(chrome.indexOf('<nav aria-label='), chrome.indexOf('</nav>'));
  assert.ok(!nav.includes('/login'), 'the header nav still hard-codes the login link');
  const link = readFileSync('components/StudentNavLink.tsx', 'utf8');
  assert.match(link, /<Suspense fallback=\{<StudentLink signedIn=\{false\} \/>\}>/);
  // Both labels are always rendered (the other one hidden and zero-height), so swapping them cannot change the width.
  assert.match(link, /<span className="spare" aria-hidden="true">/);
  const css = readFileSync('app/site.css', 'utf8');
  assert.match(css, /\.nav nav a\.me > \.spare \{ height: 0; overflow: hidden; visibility: hidden; \}/);
});
