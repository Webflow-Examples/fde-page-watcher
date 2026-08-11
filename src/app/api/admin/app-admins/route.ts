import { NextResponse } from "next/server";
import { accessErrorStatus, addAppAdmin, isAccessError, listAppAdmins, removeAppAdmin, requireAppAdmin } from "@/lib/authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = isAccessError(error) ? accessErrorStatus(error) : message.includes("valid") || message.includes("@webflow.com") ? 400 : message.includes("cannot") ? 409 : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    await requireAppAdmin(request);
    return NextResponse.json({ appAdmins: await listAppAdmins() });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAppAdmin(request);
    const body = await request.json().catch(() => null) as { email?: unknown } | null;
    if (typeof body?.email !== "string") return NextResponse.json({ error: "Email is required" }, { status: 400 });
    return NextResponse.json({ appAdmins: await addAppAdmin(body.email, actor.email) }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAppAdmin(request);
    const body = await request.json().catch(() => null) as { email?: unknown } | null;
    if (typeof body?.email !== "string") return NextResponse.json({ error: "Email is required" }, { status: 400 });
    return NextResponse.json({ appAdmins: await removeAppAdmin(body.email) });
  } catch (error) {
    return failure(error);
  }
}
