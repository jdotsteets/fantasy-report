// app/api/cron/ingest/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

const SOURCES_TO_INGEST = [
  3136, // Yahoo Fantasy NFL
  3137, // NBC ProFootballTalk
  3057, // PFF - NFL
  6,    // Yahoo Sports NFL
  7,    // Rotoballer NFL
  2918, // ESPN Fantasy
  3133, // CBS Sports - NFL
  15,   // FOOTBALL GUYS news
  3121, // FantasyPros Main
  9,    // Pro Football Rumors
] as const;

type IngestRouteResponse = {
  ok?: boolean;
  new?: number;
  processed?: number;
  error?: string;
  job_id?: number;
  jobId?: string;
};

type SourceIngestResult = {
  sourceId: number;
  ok: boolean;
  status: number;
  new: number;
  processed: number;
  jobId?: string;
  job_id?: number;
  error?: string;
};

type TransactionRouteResponse = {
  success?: boolean;
  total?: number;
  ingested?: number;
  error?: string;
  yearMonth?: string;
  types?: string;
};

type TransactionsResult = {
  ok: boolean;
  status: number;
  ingested: number;
  total: number;
  error?: string;
  yearMonth?: string;
};

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.slice("Bearer ".length);
}

async function ingestSingleSource(
  request: Request,
  sourceId: number,
  cronSecret: string
): Promise<SourceIngestResult> {
  try {
    const ingestUrl = new URL("/api/admin/ingest", request.url);

    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({
        sourceId,
        limit: 20,
        sport: "nfl",
      }),
      cache: "no-store",
    });

    const data = (await response.json()) as IngestRouteResponse;

    const result: SourceIngestResult = {
      sourceId,
      ok: response.ok && data.ok !== false,
      status: response.status,
      new: Number(data.new ?? 0),
      processed: Number(data.processed ?? 0),
      jobId: data.jobId,
      job_id: data.job_id,
      error: typeof data.error === "string" ? data.error : undefined,
    };

    if (!result.ok) {
      console.error("[cron/ingest] source failed", {
        sourceId,
        status: result.status,
        error: result.error ?? "Unknown error",
      });
    } else {
      console.log("[cron/ingest] source complete", {
        sourceId,
        new: result.new,
        processed: result.processed,
        jobId: result.jobId ?? result.job_id,
      });
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    console.error("[cron/ingest] source threw", {
      sourceId,
      error: message,
    });

    return {
      sourceId,
      ok: false,
      status: 500,
      new: 0,
      processed: 0,
      error: message,
    };
  }
}

async function ingestTransactions(
  request: Request,
  cronSecret: string
): Promise<TransactionsResult> {
  try {
    const transactionUrl = new URL("/api/admin/ingest/transactions", request.url);

    const response = await fetch(transactionUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cronSecret}`,
      },
      cache: "no-store",
    });

    const data = (await response.json()) as TransactionRouteResponse;

    const result: TransactionsResult = {
      ok: response.ok && data.success !== false,
      status: response.status,
      ingested: Number(data.ingested ?? 0),
      total: Number(data.total ?? 0),
      error: typeof data.error === "string" ? data.error : undefined,
      yearMonth: typeof data.yearMonth === "string" ? data.yearMonth : undefined,
    };

    if (!result.ok) {
      console.error("[cron/ingest] transactions failed", {
        status: result.status,
        error: result.error ?? "Unknown error",
      });
    } else {
      console.log("[cron/ingest] transactions complete", {
        ingested: result.ingested,
        total: result.total,
        yearMonth: result.yearMonth,
      });
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    console.error("[cron/ingest] transactions threw", {
      error: message,
    });

    return {
      ok: false,
      status: 500,
      ingested: 0,
      total: 0,
      error: message,
    };
  }
}

export async function GET(request: Request) {
  const requestToken = getBearerToken(request);
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[cron/ingest] Missing CRON_SECRET environment variable");
    return NextResponse.json(
      { ok: false, error: "Server misconfiguration" },
      { status: 500 }
    );
  }

  if (!requestToken || requestToken !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[cron/ingest] starting run", {
    timestamp: new Date().toISOString(),
    sourceCount: SOURCES_TO_INGEST.length,
  });

  const sourceResults = await Promise.all(
    SOURCES_TO_INGEST.map((sourceId) => ingestSingleSource(request, sourceId, cronSecret))
  );

  const totalNew = sourceResults.reduce((sum, result) => sum + result.new, 0);
  const totalProcessed = sourceResults.reduce((sum, result) => sum + result.processed, 0);
  const failedSources = sourceResults.filter((result) => !result.ok).length;

  const transactions = await ingestTransactions(request, cronSecret);

  const overallOk = failedSources === 0 && transactions.ok;

  console.log("[cron/ingest] finished run", {
    totalNew,
    totalProcessed,
    failedSources,
    transactionsOk: transactions.ok,
    transactionsIngested: transactions.ingested,
  });

  return NextResponse.json({
    ok: overallOk,
    timestamp: new Date().toISOString(),
    sources: SOURCES_TO_INGEST.length,
    totalNew,
    totalProcessed,
    failedSources,
    results: sourceResults,
    transactions,
  });
}