import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConnectionLimit,
  DEFAULT_MAX_PER_IP,
  clientKey,
  maxPerIp,
} from '../server/src/rooms/ConnectionLimit.js';

test('a client gets a limited number of slots, and a closed one is returned once', () => {
  const limit = new ConnectionLimit(2);
  const first = limit.acquire('a')!;
  assert.ok(limit.acquire('a'));
  assert.equal(limit.acquire('a'), null);
  assert.ok(limit.acquire('b'), 'another client is not affected');

  first();
  first();
  assert.ok(limit.acquire('a'));
  assert.equal(limit.acquire('a'), null, 'releasing twice frees one slot only');
});

test('unknown clients and a zero limit are not restricted', () => {
  const limit = new ConnectionLimit(1);
  for (let i = 0; i < 5; i++) assert.ok(limit.acquire(null));
  const off = new ConnectionLimit(0);
  for (let i = 0; i < 5; i++) assert.ok(off.acquire('a'));
});

test('the limit can be set from the environment', () => {
  assert.equal(maxPerIp('5'), 5);
  assert.equal(maxPerIp('0'), 0);
  for (const bad of [undefined, '', ' ', 'abc', '-1', '2.5']) {
    assert.equal(maxPerIp(bad), DEFAULT_MAX_PER_IP, String(bad));
  }
});

test('on Render the address comes from Cloudflare headers, never from X-Forwarded-For', () => {
  const spoofed = { 'x-forwarded-for': '1.1.1.1, 203.0.113.7' };
  assert.equal(clientKey({ ...spoofed, 'cf-connecting-ip': '203.0.113.7' }, '10.0.0.1', true), '203.0.113.7');
  assert.equal(clientKey({ 'true-client-ip': '203.0.113.8' }, '10.0.0.1', true), '203.0.113.8');
  // no usable header: better no limit than one shared by everybody behind the proxy
  assert.equal(clientKey(spoofed, '10.0.0.1', true), null);
  assert.equal(clientKey({ 'cf-connecting-ip': 'nonsense' }, '10.0.0.1', true), null);
});

test('off Render the headers are ignored', () => {
  assert.equal(clientKey({ 'cf-connecting-ip': '1.1.1.1' }, '192.168.0.5', false), '192.168.0.5');
  assert.equal(clientKey({}, '::ffff:192.168.0.5', false), '192.168.0.5');
});

test('IPv6 addresses of one /64 count as one client', () => {
  const key = (ip: string) => clientKey({}, ip, false);
  assert.equal(key('2001:db8:1:2::1'), key('2001:0DB8:0001:0002:ffff:ffff:ffff:ffff'));
  assert.notEqual(key('2001:db8:1:2::1'), key('2001:db8:1:3::1'));
  assert.equal(key('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(key('::1'), '0:0:0:0::/64');
});
