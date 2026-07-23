import { NextResponse } from "next/server";
import { discoverPageTitle, PageTitleError } from "@/lib/pageTitle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  url?: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.url?.trim()) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    return NextResponse.json(await discoverPageTitle(body.url));
  } catch (error) {
    if (!(error instanceof PageTitleError)) {
      return NextResponse.json({ error: "The page title could not be found" }, { status: 502 });
    }
    const status =
      error.code === "invalid_url" || error.code === "blocked_url"
        ? 400
        : error.code === "unsupported_content" || error.code === "title_not_found"
          ? 422
          : error.code === "timed_out"
            ? 504
            : 502;
    return NextResponse.json({ error: error.message }, { status });
  }
}
