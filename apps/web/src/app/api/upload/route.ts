import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { ulid } from 'ulid';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const scope = String(formData.get('scope') || '');
    
    if (!file) {
      return NextResponse.json({ error: 'No file received.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = path.extname(file.name);
    const filename = `${ulid()}${ext}`;
    const isProductImage = scope === 'product-image' || file.type.startsWith('image/');
    const absolutePath = isProductImage
      ? path.join(process.cwd(), 'public', 'catalogue-images', 'manual', filename)
      : `/tmp/${filename}`;
    if (isProductImage) {
      await mkdir(path.dirname(absolutePath), { recursive: true });
    }
    await writeFile(absolutePath, buffer);
    
    return NextResponse.json({
      success: true,
      filePath: absolutePath,
      publicUrl: isProductImage ? `/catalogue-images/manual/${filename}` : null,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
