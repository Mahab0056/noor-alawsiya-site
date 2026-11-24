'use client';

import { useCallback, useEffect, useRef } from 'react';
import { countFunnelAction } from '@/app/funnel-actions';

type BrowserStep = 'view' | 'start' | 'review';

/**
 * Sign-up counters for the registration form (FUNNEL_COUNTS on, lib/funnel.ts). `from` is the source the page worked
 * out; undefined (the flag off) means nothing is ever reported. Each step is reported once per visit to the page:
 * `view` when the form opens, `review` when the review step (`step` 2) shows, and `start` through the returned
 * function, at the first thing typed or picked. Fire and forget: the answer is not awaited and an error is swallowed.
 * Kept out of RegisterForm so its only effect stays the focus one.
 */
export function useFunnelSteps(from: string | undefined, step: number) {
  const reported = useRef(new Set<BrowserStep>());
  const report = useCallback(
    (s: BrowserStep) => {
      if (from === undefined || reported.current.has(s)) return;
      reported.current.add(s);
      countFunnelAction(s, from).catch(() => {});
    },
    [from]
  );
  useEffect(() => report('view'), [report]);
  useEffect(() => {
    if (step === 2) report('review');
  }, [step, report]);
  return report;
}
