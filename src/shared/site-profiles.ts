/**
 * Site profiles: per-domain configuration - custom element hints and
 * a trusted action allowlist. Stored in chrome.storage.local.
 *
 * These are injected into the page context sent to Claude so the agent knows
 * domain-specific hints ("on this site, the 'checkout' button has class X").
 */
import { z } from 'zod';

const PROFILE_KEY_PREFIX = 'aria.siteprofile.';

export const SiteShortcut = z.object({
  key: z.string(),
  modifiers: z.array(z.enum(['ctrl', 'alt', 'shift', 'meta'])).default([]),
  command: z.string().min(1),
});
export type SiteShortcut = z.infer<typeof SiteShortcut>;

export const SiteProfile = z.object({
  hostname: z.string(),
  hints: z.array(z.string()),
  allowedActions: z.array(z.string()),
  shortcuts: z.array(SiteShortcut).optional().default([]),
});
export type SiteProfile = z.infer<typeof SiteProfile>;

export async function loadSiteProfile(hostname: string): Promise<SiteProfile | null> {
  const key = PROFILE_KEY_PREFIX + hostname;
  const raw = await chrome.storage.local.get(key);
  const data = raw[key];
  if (!data) return null;
  const result = SiteProfile.safeParse(data);
  return result.success ? result.data : null;
}

export async function saveSiteProfile(profile: SiteProfile): Promise<void> {
  const key = PROFILE_KEY_PREFIX + profile.hostname;
  await chrome.storage.local.set({ [key]: profile });
}

export async function loadAllSiteProfiles(): Promise<SiteProfile[]> {
  const raw = await chrome.storage.local.get(null);
  const profiles: SiteProfile[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith(PROFILE_KEY_PREFIX)) {
      const result = SiteProfile.safeParse(value);
      if (result.success) profiles.push(result.data);
    }
  }
  return profiles;
}

export async function deleteSiteProfile(hostname: string): Promise<void> {
  await chrome.storage.local.remove(PROFILE_KEY_PREFIX + hostname);
}
