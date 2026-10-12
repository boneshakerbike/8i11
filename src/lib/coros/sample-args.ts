/**
 * Best-guess arguments for a COROS read tool, built from its input schema.
 *
 * Used only by the Phase 0 probe, before the real parameter formats are known.
 * Date fields get the last `days` days ending today; a wrong guess comes back
 * as a tool error, which is itself what the probe needs to learn.
 */

interface SchemaProp {
  type?: string | string[];
  description?: string;
  pattern?: string;
  format?: string;
  enum?: unknown[];
}

export interface ToolInputSchema {
  properties?: Record<string, object>;
  required?: string[];
}

const types_of = (p: SchemaProp): string[] => (Array.isArray(p.type) ? p.type : p.type ? [p.type] : []);

/** YYYY-MM-DD minus n days, as YYYY-MM-DD. */
export function shift_date(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function format_date(date: string, prop: SchemaProp): string | number {
  const text = `${prop.description ?? ''} ${prop.pattern ?? ''}`.toLowerCase();
  const compact = date.replaceAll('-', '');
  const is_integer = types_of(prop).some(t => t === 'integer' || t === 'number');
  if (/timestamp|epoch/.test(text)) {
    const seconds = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
    return /milli|\bms\b/.test(text) ? seconds * 1000 : seconds;
  }
  if (prop.format === 'date' || /yyyy-mm-dd/.test(text)) return date;
  if (is_integer || /yyyymmdd|\\d\{8\}/.test(text)) return is_integer ? Number(compact) : compact;
  return date;
}

export function build_sample_args(schema: ToolInputSchema | undefined, today: string, days = 7): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const required = new Set(schema?.required ?? []);
  const start = shift_date(today, days - 1);

  for (const [name, raw] of Object.entries(schema?.properties ?? {})) {
    const prop = raw as SchemaProp;
    const key = name.toLowerCase();
    const is_date = /date|day/.test(key) && !/days$|count|num/.test(key);

    if (is_date && /start|begin|from/.test(key)) args[name] = format_date(start, prop);
    else if (is_date && /end|until|to$/.test(key)) args[name] = format_date(today, prop);
    else if (is_date) args[name] = format_date(today, prop);
    else if (!required.has(name)) continue;
    else if (prop.enum?.length) args[name] = prop.enum[0];
    else if (/^days?$|daycount|day_count/.test(key)) args[name] = days;
    else if (/size|limit/.test(key)) args[name] = 20;
    else if (/page/.test(key)) args[name] = 1;
  }
  return args;
}
