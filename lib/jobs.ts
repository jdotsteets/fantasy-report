// lib/jobs.ts
import { dbQuery } from "@/lib/db";

export type JobType = "ingest" | "backfill";
export type JobStatus = "queued" | "running" | "success" | "error";
export type JobEventLevel = "info" | "warn" | "error" | "debug";

export type JobRow = {
  id: string;
  type: JobType;
  params: unknown;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  status: JobStatus;
  progress_current: number;
  progress_total: number | null;
  last_message: string | null;
  error_detail: string | null;
  actor: string | null;
};

export type JobEventRow = {
  id: number;
  job_id: string;
  ts: string;
  level: JobEventLevel;
  message: string;
  meta: unknown | null;
};

/** ----- helpers: normalize dbQuery results without `any` ----- */

type QueryResultLike<T> = { rows: T[] } | T[];

/** Narrow to rows array whether dbQuery returns QueryResult<T> or T[] */
function toRows<T>(res: QueryResultLike<T>): T[] {
  return Array.isArray(res) ? res : res.rows;
}

/** Return first row or null */
function firstRow<T>(res: QueryResultLike<T>): T | null {
  const rows = toRows(res);
  return rows.length > 0 ? rows[0] : null;
}

/** ----- API ----- */

export async function createJob(
  type: JobType,
  params: Record<string, unknown>,
  actor?: string
): Promise<JobRow> {
  const sql = `
    INSERT INTO jobs (type, params, status, actor, started_at)
    VALUES ($1, $2::jsonb, 'running', $3, now())
    RETURNING *`;
  const res = await dbQuery<JobRow>(sql, [type, params, actor ?? null]);
  const row = firstRow(res);
  if (!row) throw new Error("createJob: insert returned no row");
  return row;
}

export async function finishJobSuccess(jobId: string, lastMessage?: string): Promise<void> {
  const sql = `UPDATE jobs
    SET status='success', finished_at=now(), last_message=COALESCE($2,last_message)
    WHERE id=$1`;
  await dbQuery(sql, [jobId, lastMessage ?? null]);
}

export async function failJob(jobId: string, errorDetail: string): Promise<void> {
  const sql = `UPDATE jobs
    SET status='error', finished_at=now(), error_detail=$2, last_message='failed'
    WHERE id=$1`;
  await dbQuery(sql, [jobId, errorDetail]);
}

export async function setProgress(jobId: string, current: number, total?: number): Promise<void> {
  const sql = `UPDATE jobs
    SET progress_current=$2, progress_total=COALESCE($3, progress_total)
    WHERE id=$1`;
  await dbQuery(sql, [jobId, current, total ?? null]);
}

export async function appendEvent(
  jobId: string,
  level: JobEventLevel,
  message: string,
  meta?: Record<string, unknown>
): Promise<JobEventRow> {
  const sql = `INSERT INTO job_events (job_id, level, message, meta)
               VALUES ($1, $2, $3, $4::jsonb)
               RETURNING *`;
  const res = await dbQuery<JobEventRow>(sql, [jobId, level, message, meta ?? null]);
  const row = firstRow(res);
  if (!row) throw new Error("appendEvent: insert returned no row");
  return row;
}

export async function getJob(jobId: string): Promise<JobRow | null> {
  const sql = `SELECT * FROM jobs WHERE id=$1`;
  const res = await dbQuery<JobRow>(sql, [jobId]);
  return firstRow(res);
}

export async function getEventsSince(jobId: string, afterId?: number): Promise<JobEventRow[]> {
  const sql = afterId
    ? `SELECT * FROM job_events WHERE job_id=$1 AND id>$2 ORDER BY id ASC`
    : `SELECT * FROM job_events WHERE job_id=$1 ORDER BY id ASC`;
  const params = afterId ? [jobId, afterId] as const : [jobId] as const;
  const res = await dbQuery<JobEventRow>(sql, params as unknown as (string | number)[]); // params are typed
  return toRows(res);
}
