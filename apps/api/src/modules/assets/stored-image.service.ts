import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { lookup } from 'dns/promises';
import { promises as fs } from 'fs';
import { isIP } from 'net';
import * as path from 'path';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 12_000;

@Injectable()
export class StoredImageService {
  async persistRemoteImage(rawUrl: unknown): Promise<string> {
    const input = String(rawUrl || '').trim();
    if (!input) return '';
    if (this.isTrustedBundledPath(input)) return input;

    const managed = this.managedPublicUrl(input);
    if (managed) return managed;

    let url = this.parseRemoteUrl(input);
    let response: any;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      await this.assertPublicHost(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        response = await fetch(url, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.2', 'User-Agent': 'MarbleParkERP/1.0' },
        } as any);
      } catch (error: any) {
        throw new BadRequestException(`Could not download quote image: ${error?.name === 'AbortError' ? 'the image server timed out' : 'the image server could not be reached'}`);
      } finally {
        clearTimeout(timeout);
      }
      if (![301, 302, 303, 307, 308].includes(Number(response.status))) break;
      const location = response.headers.get('location');
      if (!location || redirects === MAX_REDIRECTS) throw new BadRequestException('Quote image redirects are invalid or exceed the allowed limit');
      url = this.parseRemoteUrl(new URL(location, url).toString());
    }

    if (!response?.ok) throw new BadRequestException(`Quote image server returned HTTP ${response?.status || 'error'}`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) throw new BadRequestException('Quote images must be 5 MB or smaller');
    const content = await this.readBoundedBody(response);
    const extension = this.detectExtension(content);
    if (!extension) throw new BadRequestException('Quote image URL must return a valid JPG, PNG, or WebP image');

    const digest = createHash('sha256').update(content).digest('hex');
    const fileName = `remote-${digest.slice(0, 32)}${extension}`;
    const root = process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.resolve(process.cwd(), '../../apps/web/public/catalogue-images');
    const directory = path.join(root, 'manual');
    const target = path.join(directory, fileName);
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.access(target);
    } catch {
      const temporary = `${target}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, content, { mode: 0o640 });
      await fs.rename(temporary, target).catch(async (error: any) => {
        await fs.rm(temporary, { force: true });
        if (error?.code !== 'EEXIST') throw error;
      });
    }
    return this.publicUrl(fileName);
  }

  private managedPublicUrl(value: string) {
    try {
      let pathname = value;
      if (!value.startsWith('/')) {
        const parsed = new URL(value);
        const configuredBase = String(process.env.PUBLIC_CATALOGUE_IMAGE_BASE_URL || '').trim();
        if (!configuredBase || parsed.origin !== new URL(configuredBase).origin) return '';
        pathname = parsed.pathname;
      }
      const match = pathname.match(/^\/catalogue-images\/manual\/([A-Za-z0-9_-]+\.(?:jpe?g|png|webp))$/i);
      return match ? this.publicUrl(match[1]) : '';
    } catch {
      return '';
    }
  }

  private publicUrl(fileName: string) {
    const base = String(process.env.PUBLIC_CATALOGUE_IMAGE_BASE_URL || '').replace(/\/+$/, '');
    return `${base}/catalogue-images/manual/${fileName}`;
  }

  private isTrustedBundledPath(value: string) {
    if (!value.startsWith('/') || value.includes('..')) return false;
    return /^\/(?:catalogue-art|catalogue-images|brand)\/[A-Za-z0-9_./-]+\.(?:jpe?g|png|webp)$/i.test(value);
  }

  private parseRemoteUrl(value: string) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException('Quote image must be a valid HTTPS URL or an uploaded Marble Park image');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new BadRequestException('Quote image URLs must use HTTPS and cannot contain credentials');
    }
    return parsed;
  }

  private async assertPublicHost(url: URL) {
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
      throw new BadRequestException('Quote image URL cannot use a private host');
    }
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true, verbatim: true }).catch(() => [] as any[]);
    if (!addresses.length || addresses.some((entry: any) => this.isPrivateAddress(String(entry.address || '')))) {
      throw new BadRequestException('Quote image URL must resolve to a public internet address');
    }
  }

  private isPrivateAddress(address: string) {
    const normalized = address.toLowerCase().split('%')[0];
    if (normalized.startsWith('::ffff:')) return this.isPrivateAddress(normalized.slice(7));
    if (isIP(normalized) === 4) {
      const [a, b] = normalized.split('.').map(Number);
      return a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19));
    }
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized);
  }

  private async readBoundedBody(response: any) {
    if (!response.body) throw new BadRequestException('Quote image server returned an empty response');
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      bytes += chunk.length;
      if (bytes > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new BadRequestException('Quote images must be 5 MB or smaller');
      }
      chunks.push(chunk);
    }
    if (!bytes) throw new BadRequestException('Quote image server returned an empty image');
    return Buffer.concat(chunks);
  }

  private detectExtension(content: Buffer) {
    if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
    if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return '.jpg';
    if (content.length >= 12 && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
    return '';
  }
}
