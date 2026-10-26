import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetUnknownIpWarning, resolveClientIp, UNKNOWN_IP } from './client-ip.js';

const request = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/chat', { headers });

beforeEach(() => resetUnknownIpWarning());
afterEach(() => vi.restoreAllMocks());

describe('resolveClientIp', () => {
  it('prefers the framework-provided address', () => {
    const req = request({ 'x-forwarded-for': '9.9.9.9' });
    expect(resolveClientIp(req, { clientIp: '1.2.3.4' }, 'x-forwarded-for')).toBe('1.2.3.4');
  });

  it('takes the rightmost X-Forwarded-For entry, which the proxy wrote', () => {
    const req = request({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1, 5.5.5.5' });
    expect(resolveClientIp(req, {}, 'x-forwarded-for')).toBe('5.5.5.5');
  });

  it('ignores proxy headers unless told to trust one', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveClientIp(request({ 'x-forwarded-for': '5.5.5.5' }))).toBe(UNKNOWN_IP);
  });

  it('falls back to a shared bucket and warns only once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveClientIp(request());
    resolveClientIp(request());
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
