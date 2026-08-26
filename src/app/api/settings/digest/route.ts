import { NextResponse } from "next/server";
import { setDigestSettings } from "@/lib/mutations";
import { isDigestCadence } from "@/lib/digestCadence";
import { digestRecipientIsValid, MAX_DIGEST_RECIPIENTS } from "@/lib/digestRecipients";
import { projectStore } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cadence and recipients, together, because they are the whole of the digest
 * setting. Daily or weekly, and who it goes to; there is no third field and no
 * per-page variant of either.
 *
 * A bad address is rejected rather than dropped. `normalizeDigestRecipients`
 * drops one when it reads stored state, which is right there and wrong here: a
 * reader who typed an address and got a success response would believe somebody
 * was on the list.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { cadence?: unknown; recipients?: unknown };
  if (!isDigestCadence(body.cadence)) {
    return NextResponse.json({ error: "Choose a daily or weekly digest" }, { status: 400 });
  }
  const recipients = body.recipients;
  if (!Array.isArray(recipients) || recipients.some((entry) => typeof entry !== "string")) {
    return NextResponse.json({ error: "Recipients must be a list of email addresses" }, { status: 400 });
  }
  if (recipients.length > MAX_DIGEST_RECIPIENTS) {
    return NextResponse.json(
      { error: `A digest goes to at most ${MAX_DIGEST_RECIPIENTS} addresses` },
      { status: 400 },
    );
  }
  const invalid = (recipients as string[]).find((entry) => !digestRecipientIsValid(entry));
  if (invalid !== undefined) {
    return NextResponse.json({ error: `"${invalid}" is not an email address` }, { status: 400 });
  }

  try {
    const state = await setDigestSettings(
      { cadence: body.cadence, recipients: recipients as string[] },
      await projectStore(req),
    );
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
