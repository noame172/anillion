'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, type ApiError } from '@/lib/client/api';

/** Load a resource from the admin API, with reload and error state. */
export function useAdmin<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await apiFetch<T>(`/api/admin/${path}`));
      setError('');
    } catch (err) {
      setError((err as ApiError).message);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, reload };
}

/** Run an admin write; returns an error message or '' on success. */
export async function adminCall(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown = {}): Promise<{ data?: any; error: string }> {
  try {
    return { data: await apiFetch(`/api/admin/${path}`, { method, body }), error: '' };
  } catch (err) {
    return { error: (err as ApiError).message };
  }
}
