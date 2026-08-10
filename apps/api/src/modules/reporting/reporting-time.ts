import { BadRequestException } from '@nestjs/common';

export const REPORT_TIMEZONE = 'Asia/Kolkata';
const DAY = 86_400_000;

function indiaDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function parseDateOnly(value: string, end = false): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Report dates must use YYYY-MM-DD');
  const parsed = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}+05:30`);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Report date is invalid');
  return parsed;
}

export function reportRange(fromValue?: string, toValue?: string) {
  const today = indiaDate(new Date());
  const to = parseDateOnly(toValue || today, true);
  const from = fromValue ? parseDateOnly(fromValue) : new Date(to.getTime() - 30 * DAY + 1);
  if (from > to) throw new BadRequestException('Report start date must be before end date');
  const durationDays = Math.max(1, Math.round((to.getTime() - from.getTime() + 1) / DAY));
  const priorTo = new Date(from.getTime() - 1);
  const priorFrom = new Date(priorTo.getTime() - durationDays * DAY + 1);
  return {
    from,
    to,
    priorFrom,
    priorTo,
    durationDays,
    labels: {
      from: indiaDate(from),
      to: indiaDate(to),
      priorFrom: indiaDate(priorFrom),
      priorTo: indiaDate(priorTo),
    },
  };
}

export function indiaDay(value: Date | string): string {
  return indiaDate(value instanceof Date ? value : new Date(value));
}

export function ageDays(from: Date, to = new Date()): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY));
}
