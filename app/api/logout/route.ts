import { NextResponse } from "next/server";
import { endSession } from "@/lib/video-auth";

export async function POST() {
  await endSession();
  return NextResponse.json({ ok: true });
}
