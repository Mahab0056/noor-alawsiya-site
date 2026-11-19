import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { canonicalRedirect, requestHost } from '../lib/canonical-host';
import { config, proxy } from '../proxy';

function call(path: string, headers: Record<string, string>, cookie?: string) {
  // The URL the server itself sees: Railway runs the container on 8080, so request.url carries that port.
  const req = new NextRequest(`http://localhost:8080${path}`, { headers: cookie ? { ...headers, cookie } : headers });
  return proxy(req);
}

test('the host is read from x-forwarded-host first, then Host, lower case, with no port or trailing dot', () => {
  assert.equal(requestHost('WWW.Noor-Alawsiya.com', 'xhyzx8mg.up.railway.app'), 'www.noor-alawsiya.com');
  assert.equal(requestHost(null, 'www.noor-alawsiya.com:443'), 'www.noor-alawsiya.com');
  assert.equal(requestHost('www.noor-alawsiya.com., proxy.internal', null), 'www.noor-alawsiya.com');
  assert.equal(requestHost('', 'localhost:3000'), 'localhost');
  assert.equal(requestHost(null, null), '');
});

test('only www is redirected; the apex, localhost and Railway names are served as is', () => {
  assert.equal(canonicalRedirect('www.noor-alawsiya.com', '/courses', '?a=1&b=%D8%A7'), 'https://noor-alawsiya.com/courses?a=1&b=%D8%A7');
  assert.equal(canonicalRedirect('www.noor-alawsiya.com', '/', ''), 'https://noor-alawsiya.com/');
  for (const host of ['noor-alawsiya.com', 'localhost', '127.0.0.1', 'xhyzx8mg.up.railway.app', 'site-production.up.railway.app', 'evil.www.noor-alawsiya.com.example', '']) {
    assert.equal(canonicalRedirect(host, '/', ''), null, host);
  }
});

test('proxy: www gets a 308 to the apex with the same path and query, and no internal port', () => {
  for (const [headers, path] of [
    [{ host: 'www.noor-alawsiya.com' }, '/register?course=quran&x=1'],
    [{ host: 'xhyzx8mg.up.railway.app', 'x-forwarded-host': 'www.noor-alawsiya.com' }, '/courses/tajweed'],
    [{ host: 'www.noor-alawsiya.com' }, '/'],
    // www wins over the login check: a visitor with no cookie on www/admin first lands on the apex.
    [{ host: 'www.noor-alawsiya.com' }, '/admin'],
  ] as const) {
    const res = call(path, headers);
    assert.equal(res.status, 308, path);
    assert.equal(res.headers.get('location'), `https://noor-alawsiya.com${path}`, path);
  }
});

test('proxy: the apex, localhost and *.up.railway.app pages pass through untouched', () => {
  const passHeaders: Record<string, string>[] = [
    { host: 'noor-alawsiya.com' },
    { host: 'localhost:3000' },
    { host: 'xhyzx8mg.up.railway.app' },
    { host: 'xhyzx8mg.up.railway.app', 'x-forwarded-host': 'noor-alawsiya.com' },
  ];
  for (const headers of passHeaders) {
    const res = call('/courses?a=1', headers);
    assert.equal(res.status, 200, JSON.stringify(headers));
    assert.equal(res.headers.get('location'), null);
    assert.equal(res.headers.get('x-middleware-next'), '1');
  }
});

test('proxy: the login check still works on the apex', () => {
  const apex = { host: 'noor-alawsiya.com' };
  assert.match(call('/admin/courses', apex).headers.get('location') ?? '', /\/admin\/login$/);
  assert.match(call('/account', apex).headers.get('location') ?? '', /\/login$/);
  assert.equal(call('/admin/login', apex).headers.get('location'), null);
  assert.equal(call('/admin/invite/abc', apex).headers.get('location'), null);
  assert.equal(call('/admin', apex, 'noor_a=x').headers.get('location'), null);
  assert.equal(call('/account/x', apex, 'noor_s=x').headers.get('location'), null);
  // Pages outside /admin and /account never need a cookie, and look-alike paths are not treated as /admin.
  for (const p of ['/', '/register', '/login', '/administration', '/accounting']) {
    assert.equal(call(p, apex).headers.get('location'), null, p);
  }
});

test('the matcher covers pages but leaves built files, images and the favicon out', () => {
  const re = new RegExp(`^${config.matcher[0]}$`);
  for (const p of ['/', '/register', '/admin/login', '/robots.txt', '/sitemap.xml', '/courses/x']) assert.ok(re.test(p), p);
  for (const p of ['/_next/static/chunks/a.js', '/_next/image', '/favicon.ico', '/img/icon-512.png']) assert.ok(!re.test(p), p);
});
