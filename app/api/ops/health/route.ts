import { NextRequest, NextResponse } from "next/server";
import { dbQueryRow, dbQueryRows } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SocialCountRow = { status: string; n: string };

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [refreshJob, socialCounts, socialDue, socialLastPublished] = await Promise.all([
    dbQueryRow<{
      id: string;
      status: string;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
      last_message: string | null;
      error_detail: string | null;
    }>(
      `select id, status, created_at::text, started_at::text, finished_at::text, last_message, error_detail
         from jobs
        where type = 'ingest'
          and coalesce(params->>'scope', '') = 'allowed'
        order by created_at desc
        limit 1`
    ),
    dbQueryRows<SocialCountRow>(
      `select status, count(*)::text as n
         from social_drafts
        group by status`
    ),
    dbQueryRow<{ due_now: string }>(
      `select count(*)::text as due_now
         from social_drafts
        where platform = 'x'
          and status = 'scheduled'
          and scheduled_for is not null
          and scheduled_for <= now()`
    ),
    dbQueryRow<{ last_published_at: string | null }>(
      `select max(updated_at)::text as last_published_at
         from social_drafts
        where platform = 'x'
          and status = 'published'`
    ),
  ]);

  const socialByStatus = Object.fromEntries(
    socialCounts.map((r) => [r.status, Number(r.n)])
  );

  return NextResponse.json({
    ok: true,
    now: new Date().toISOString(),
    refresh: {
      lastJob: refreshJob ?? null,
    },
    social: {
      byStatus: socialByStatus,
      dueNow: Number(socialDue?.due_now ?? "0"),
      lastPublishedAt: socialLastPublished?.last_published_at ?? null,
    },
  });
}
