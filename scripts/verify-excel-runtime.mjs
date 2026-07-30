import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const streamFile = join(tmpdir(), `marble-park-excel-${randomUUID()}.xlsx`);

try {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  sheet.getCell('A1').value = 'SKU';
  sheet.getCell('A2').value = 'RUNTIME-CHECK-001';
  const imageId = workbook.addImage({ buffer: png, extension: 'png' });
  sheet.addImage(imageId, 'B2:C3');

  const buffer = await workbook.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);

  const loadedSheet = loaded.getWorksheet('Products');
  assert.equal(loadedSheet.getCell('A2').value, 'RUNTIME-CHECK-001');
  assert.equal(loadedSheet.getImages().length, 1);

  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: streamFile });
  writer.addWorksheet('Products').addRow(['STREAM-CHECK-001']).commit();
  await writer.commit();

  const rows = [];
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(streamFile);
  for await (const worksheet of reader) {
    for await (const row of worksheet) rows.push(row.getCell(1).value);
  }
  assert.deepEqual(rows, ['STREAM-CHECK-001']);

  console.log(
    JSON.stringify({
      standardBytes: buffer.byteLength,
      embeddedImages: loadedSheet.getImages().length,
      streamingRows: rows.length,
    }),
  );
} finally {
  await rm(streamFile, { force: true });
}
