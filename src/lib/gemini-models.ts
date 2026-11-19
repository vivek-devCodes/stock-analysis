/**
 * Gemini models to try, in order. Google retires model names for new keys (gemini-2.5-flash now
 * returns 404 "no longer available to new users"), so callers fall through this list when a model
 * is gone (404) or overloaded (503). Set GEMINI_MODEL to put a specific model first.
 */
const DEFAULTS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-flash-latest"];

export function geminiModels(): string[] {
  const preferred = process.env.GEMINI_MODEL?.trim();
  return [...new Set([...(preferred ? [preferred] : []), ...DEFAULTS])];
}

/** True when the error means "try the next model": the model is retired/unknown, or temporarily overloaded. */
export function shouldTryNextModel(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  return /NOT_FOUND|no longer available|is not found|"code":\s*404\b|\b404\b|UNAVAILABLE|high demand|overloaded|"code":\s*503\b|\b503\b/i.test(raw);
}
