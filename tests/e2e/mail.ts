/**
 * Reads 6-digit codes from the local Supabase mail catcher. Newer CLIs ship
 * Mailpit, older ones Inbucket; both are supported and detected at runtime.
 */

const MAIL_URL = process.env.MAIL_URL || "http://127.0.0.1:54324";

type Flavour = "mailpit" | "inbucket";
let detected: Flavour | null = null;

async function flavour(): Promise<Flavour> {
  if (detected) return detected;
  try {
    const res = await fetch(`${MAIL_URL}/api/v1/info`);
    detected = res.ok ? "mailpit" : "inbucket";
  } catch {
    detected = "inbucket";
  }
  return detected;
}

interface Mail {
  id: string;
  subject: string;
  text: string;
}

async function listMail(address: string): Promise<Mail[]> {
  if ((await flavour()) === "mailpit") {
    const url = `${MAIL_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const body = (await res.json()) as { messages?: { ID: string; Subject: string; Snippet?: string }[] };
    // Mailpit returns newest first.
    return (body.messages ?? []).map((m) => ({ id: m.ID, subject: m.Subject ?? "", text: m.Snippet ?? "" }));
  }
  const name = address.split("@")[0];
  const res = await fetch(`${MAIL_URL}/api/v1/mailbox/${encodeURIComponent(name)}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { id: string; subject: string }[];
  // Inbucket returns oldest first.
  return body.map((m) => ({ id: m.id, subject: m.subject ?? "", text: "" })).reverse();
}

/** How many messages have been delivered to `address` so far. */
export async function mailCount(address: string): Promise<number> {
  return (await listMail(address)).length;
}

export function extractCode(text: string): string | null {
  return text.match(/\b\d{6}\b/)?.[0] ?? null;
}

/**
 * Waits for a message beyond the first `previous` and returns the 6-digit
 * code in the newest one. Call `mailCount(address)` before triggering the
 * send, and pass it as `previous`, when the address may already have mail.
 */
export async function waitForCode(address: string, { previous = 0, timeoutMs = 20000 } = {}): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mails = await listMail(address);
    if (mails.length > previous) {
      const newest = mails[0];
      // The subject always carries the code ("Your Ally code: 123456").
      const fromSubject = extractCode(newest.subject) ?? extractCode(newest.text);
      if (fromSubject) return fromSubject;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no mail with a code arrived for ${address} within ${timeoutMs}ms`);
}

/** True if any message has been delivered to `address` (used to assert "no mail sent"). */
export async function hasMail(address: string): Promise<boolean> {
  return (await mailCount(address)) > 0;
}
