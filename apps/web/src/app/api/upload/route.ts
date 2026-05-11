import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const scope = String(formData.get('scope') || '');
    
    if (!file) {
      return NextResponse.json({ error: 'No file received.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/graphql';
    const authorization = req.headers.get('authorization') || '';
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
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
      filePath: result.filePath,
      publicUrl: result.publicUrl,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
