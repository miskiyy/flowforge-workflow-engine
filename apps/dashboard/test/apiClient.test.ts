import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, createQueryClient } from '../src/api/client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('apiFetch', () => {
  it('parses the error envelope into ApiError fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ error: { code: 'INVALID_DAG', message: 'bad dag', details: [{ path: '/steps/0' }] } }),
      }),
    );

    await expect(apiFetch('/workflows')).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_DAG',
      message: 'bad dag',
      details: [{ path: '/steps/0' }],
    });
  });

  it('falls back to a generic message when the body is not the envelope shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    await expect(apiFetch('/workflows')).rejects.toMatchObject({ status: 500, code: 'UNKNOWN_ERROR' });
  });

  it('sends the bearer token and a JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/workflows', { token: 'tok', method: 'POST', body: { name: 'x' } });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/workflows',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: 'x' }),
      }),
    );
  });
});

describe('createQueryClient', () => {
  it('never retries a 4xx query error', async () => {
    const queryClient = createQueryClient();
    const queryFn = vi.fn().mockRejectedValue(new ApiError(422, { code: 'INVALID_DAG', message: 'bad' }));

    await expect(queryClient.fetchQuery({ queryKey: ['x'], queryFn })).rejects.toThrow();
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx query error twice before giving up', async () => {
    const queryClient = createQueryClient();
    const queryFn = vi.fn().mockRejectedValue(new ApiError(503, { code: 'UNAVAILABLE', message: 'down' }));

    await expect(queryClient.fetchQuery({ queryKey: ['y'], queryFn, retryDelay: 0 })).rejects.toThrow();
    expect(queryFn).toHaveBeenCalledTimes(3); // 1 initial attempt + 2 retries
  });

  it('clears the stored session and redirects to /login on a 401 from any query', async () => {
    localStorage.setItem('flowforge_auth', JSON.stringify({ token: 'tok', email: 'a@b.com' }));
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });

    const queryClient = createQueryClient();
    const queryFn = vi.fn().mockRejectedValue(new ApiError(401, { code: 'UNAUTHORIZED', message: 'expired' }));

    await queryClient.fetchQuery({ queryKey: ['z'], queryFn }).catch(() => {});

    expect(localStorage.getItem('flowforge_auth')).toBeNull();
    expect(assign).toHaveBeenCalledWith(expect.stringContaining('/login?next='));
  });
});
