import { NextResponse } from "next/server";
import { SYSTEM_WRITER, SYSTEM_CRITIC } from "@/lib/agent/prompts";

export const runtime = "nodejs";

export async function GET() {
  // Keep this minimal: just return current defaults from your file.
  return NextResponse.json({
    system_writer: SYSTEM_WRITER,
    system_critic: SYSTEM_CRITIC,
  });
}
