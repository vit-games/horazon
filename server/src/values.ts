import { getSettings } from './settings.js';

/** What every view and overlay loads alongside the drops: the user's item tiers (null = the default). */
export async function getValues() {
  const settings = await getSettings();
  return { tiers: settings.tiers };
}
