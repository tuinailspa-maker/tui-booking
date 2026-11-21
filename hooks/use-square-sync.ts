"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";

const SYNC_POLL_MS = 10_000;

async function fetchSyncVersion(url: string): Promise<string | null> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as { version?: string | null } | null;
  return data?.version ?? null;
}

/**
 * Polls the Square webhook sync version and calls `onChange` whenever Square reports a
 * booking, team member, or catalog change, so live availability is refetched immediately.
 */
export function useSquareSync(onChange: () => void) {
  const { data: version } = useSWR("/api/square/sync", fetchSyncVersion, {
    refreshInterval: SYNC_POLL_MS,
    revalidateOnFocus: true,
    dedupingInterval: 2_000,
  });
  const previous = useRef<string | null | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (version === undefined || version === null) return;
    if (previous.current !== undefined && previous.current !== version) onChangeRef.current();
    previous.current = version;
  }, [version]);
}
