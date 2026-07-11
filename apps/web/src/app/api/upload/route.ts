import { NextRequest, NextResponse } from 'next/server';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const scope = String(formData.get('scope') || '');
    
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file received.' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type) || !/\.(jpe?g|png|webp)$/i.test(file.name)) {
      return NextResponse.json({ error: 'Only JPG, PNG, and WebP images are supported.' }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Images must be smaller than 5 MB.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/graphql';
    const authorization = req.headers.get('authorization') || '';
    const cookie = req.headers.get('cookie') || '';
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({
        query: `
          mutation UploadStoredAsset($filename: String!, $contentBase64: String!, $scope: String) {
            uploadStoredAsset(filename: $filename, contentBase64: $contentBase64, scope: $scope) {
              id
              result
            }
          }
        `,
        variables: {
          filename: file.name,
          contentBase64: buffer.toString('base64'),
          scope,
        },
      }),
    });
    const json = await response.json();
    if (!response.ok || json.errors?.length) {
      throw new Error(json.errors?.[0]?.message || 'Upload failed.');
    }
    const result = json.data?.uploadStoredAsset?.result || {};
    
    return NextResponse.json({
      success: true,
      publicUrl: result.publicUrl,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
