import type { ThemeMode } from "./accountState";

export const ACCOUNT_THEME_CACHE_KEY = "modeldock.account-theme-cache";

interface AccountThemeCache {
  accountId: string;
  theme: ThemeMode;
}

type ThemeCacheReader = Pick<Storage, "getItem">;
type ThemeCacheWriter = Pick<Storage, "setItem">;

export function readAccountThemeCache(
  storage: ThemeCacheReader,
): AccountThemeCache | null {
  try {
    const parsed = JSON.parse(
      storage.getItem(ACCOUNT_THEME_CACHE_KEY) ?? "null",
    ) as Partial<AccountThemeCache> | null;
    if (
      typeof parsed?.accountId === "string" &&
      parsed.accountId.length > 0 &&
      (parsed.theme === "light" || parsed.theme === "dark")
    ) {
      return { accountId: parsed.accountId, theme: parsed.theme };
    }
  } catch {
    // A malformed or unavailable cache must never block application startup.
  }
  return null;
}

export function rememberAccountTheme(
  storage: ThemeCacheWriter,
  accountId: string,
  theme: ThemeMode,
) {
  if (!accountId) return;
  try {
    storage.setItem(
      ACCOUNT_THEME_CACHE_KEY,
      JSON.stringify({ accountId, theme } satisfies AccountThemeCache),
    );
  } catch {
    // Browsers may deny local storage; server-side account state remains canonical.
  }
}
