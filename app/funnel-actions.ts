'use server';

import { getDb } from '@/lib/db';
import { countBrowserStep } from '@/lib/funnel';
import { clientIp } from '@/lib/session';

/**
 * The registration form reports three steps: it opened (`view`), the visitor started filling it in (`start`), and
 * reached the review (`review`). A Server Action is a public endpoint, so everything is checked in countBrowserStep
 * (lib/funnel.ts): the flag first, the step, an in-memory limit per address, and the source (only names of our own
 * links count). The address is never stored. Nothing is returned and nothing is thrown.
 */
export async function countFunnelAction(step: unknown, from: unknown): Promise<void> {
  await countBrowserStep(getDb, clientIp, step, from);
}
