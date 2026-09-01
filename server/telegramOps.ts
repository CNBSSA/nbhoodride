/**
 * Telegram ops alerts — pushes key platform events to the operator's phone
 * through a Telegram bot (BotFather token + private chat id).
 *
 * Configure on Railway → Variables:
 *   TELEGRAM_BOT_TOKEN  — the bot token from @BotFather
 *   TELEGRAM_CHAT_ID    — the chat to deliver to
 *
 * Fully inert when either is unset. Every send is fire-and-forget
 * best-effort: a Telegram outage must never fail the request that
 * triggered the alert, so callers use `alert()` and never await it.
 */

const SEND_TIMEOUT_MS = 8_000;

function getConfig(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

export function telegramOpsEnabled(): boolean {
  return getConfig() !== null;
}

/**
 * Compose a plain-text alert: a title line followed by "Label: value" lines,
 * skipping empty values. Plain text (no parse_mode) so free-form user content
 * (names, addresses) can never break formatting or inject markup.
 */
export function formatOpsAlert(
  title: string,
  fields: Array<[label: string, value: string | number | null | undefined]>,
): string {
  const lines = [title];
  for (const [label, value] of fields) {
    const v = value === null || value === undefined ? "" : String(value).trim();
    if (v) lines.push(`${label}: ${v}`);
  }
  return lines.join("\n");
}

async function send(text: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        text: text.slice(0, 4096), // Telegram message cap
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[telegram-ops] send failed: ${res.status} ${body.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget ops alert. Never throws, never blocks the caller. */
export function opsAlert(text: string): void {
  send(text).catch((err) => {
    console.error(`[telegram-ops] send error: ${err instanceof Error ? err.message : String(err)}`);
  });
}
