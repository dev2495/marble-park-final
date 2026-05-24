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
  const year = date.getFullYear();
  const key = `${scope}:${year}`;
  const prefixForYear = `${prefix}/${year}/`;
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

async function maxExistingSequence(prefixForYear: string, options: SequenceOptions) {
  if (!options.existingNumbers) return 0;
  const values = await options.existingNumbers(prefixForYear);
  return values.reduce((max, value) => {
    if (!value?.startsWith(prefixForYear)) return max;
    const serial = Number(value.slice(prefixForYear.length));
    return Number.isFinite(serial) ? Math.max(max, serial) : max;
  }, 0);
}
