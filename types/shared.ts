// types/shared.ts
export type Nullable<T> = T | null | undefined;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [k: string]: JsonValue };
export type JsonArray = JsonValue[];

export type StringMap = Record<string, string>;
export type UnknownMap = Record<string, unknown>;

/** Narrow unknown to a plain object (not null/array/function). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Narrow unknown to string */
export function asString(v: unknown): v is string {
  return typeof v === "string";
}
