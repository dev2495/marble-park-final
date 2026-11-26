type SequenceOptions = {
  existingNumbers?: (prefixForYear: string) => Promise<Array<string | null | undefined>>;
};

export async function nextDocumentNumber(
  tx: any,
  scope: string,
  prefix: string,
  date = new Date(),
  options: SequenceOptions = {},
) {
  const period = await numberingPeriod(tx, date);
  const key = `${scope}:${period.key}`;
  const prefixForYear = `${prefix}/${period.label}/`;
  const existingMax = await maxExistingSequence(prefixForYear, options);

  await tx.sequenceCounter.upsert({
    where: { scope: key },
    update: { updatedAt: new Date() },
    create: { scope: key, value: existingMax, updatedAt: new Date() },
  });

  if (existingMax > 0) {
    await tx.sequenceCounter.updateMany({
      where: { scope: key, value: { lt: existingMax } },
      data: { value: existingMax, updatedAt: new Date() },
    });
  }

  const counter = await tx.sequenceCounter.update({
    where: { scope: key },
    data: { value: { increment: 1 }, updatedAt: new Date() },
  });
  return `${prefixForYear}${String(counter.value).padStart(4, '0')}`;
}

const IST_OFFSET_MS = 330 * 60000;

/**
 * Settings > Document numbering. "calendar" (default) keeps the original rule
 * exactly: the year of the date in server time, counter key scope:YYYY, number
 * PREFIX/YYYY/0001. "financial" restarts on 1 April in India time, counter key
 * scope:FYYYYY, number PREFIX/2026-27/0001, so the two series never collide.
 */
export async function numberingPeriod(tx: any, date: Date): Promise<{ key: string; label: string }> {
  let mode = 'calendar';
  // No catch here: this runs inside the caller's transaction, where a failed statement
  // aborts the whole transaction, so swallowing it would only make the next step fail.
  const settings = await tx?.appSetting?.findFirst?.({ orderBy: { updatedAt: 'desc' }, select: { documentNumberingPeriod: true } });
  if (settings?.documentNumberingPeriod === 'financial') mode = 'financial';
  if (mode !== 'financial') {
    const year = date.getFullYear();
    return { key: String(year), label: String(year) };
  }
  const india = new Date(date.getTime() + IST_OFFSET_MS);
  const startYear = india.getUTCMonth() >= 3 ? india.getUTCFullYear() : india.getUTCFullYear() - 1;
  return { key: `FY${startYear}`, label: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}` };
}

async function maxExistingSequence(prefixForYear: string, options: SequenceOptions) {
  if (!options.existingNumbers) return 0;
  const values = await options.existingNumbers(prefixForYear);
  return values.reduce((max, value) => {
    if (!value?.startsWith(prefixForYear)) return max;
    const serial = Number(value.slice(prefixForYear.length));
    return Number.isFinite(serial) ? Math.max(max, serial) : max;
  }, 0);
}
