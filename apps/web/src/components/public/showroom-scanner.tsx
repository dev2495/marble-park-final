'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { IScannerControls } from '@zxing/browser';
import { Camera, CameraOff, Loader2, ScanLine } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/graphql';

type Status = { tone: 'idle' | 'busy' | 'error' | 'found'; text: string };

async function lookup(code: string, visitToken?: string) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'mutation PublicLabelLookup($code:String!,$visitToken:String){publicLabelLookup(code:$code,visitToken:$visitToken)}', variables: { code, visitToken: visitToken || null } }),
  });
  if (!response.ok) throw new Error('lookup failed');
  const body = await response.json();
  return body?.data?.publicLabelLookup as { found: boolean; token?: string; message?: string } | undefined;
}

function cameraProblem(error: unknown) {
  const name = String((error as any)?.name || '');
  if (name === 'NotAllowedError') return 'Camera access is blocked. Allow the camera for this site in your browser settings, or type the code printed under the QR.';
  if (name === 'NotFoundError') return 'This device has no camera. Type the code printed under the QR instead.';
  if (name === 'NotReadableError') return 'Another app is using the camera. Close it and try again.';
  return 'The camera could not start. You can type the code printed under the QR instead.';
}

export function ShowroomScanner({ visitToken }: { visitToken?: string }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lockedRef = useRef(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [manual, setManual] = useState('');
  const [status, setStatus] = useState<Status>({ tone: 'idle', text: '' });

  const stopCamera = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  };

  useEffect(() => () => stopCamera(), []);

  async function open(code: string) {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setStatus({ tone: 'busy', text: 'Finding this product…' });
    try {
      const result = await lookup(code, visitToken);
      if (result?.found && result.token) {
        try { navigator.vibrate?.(30); } catch { /* not supported */ }
        setStatus({ tone: 'found', text: 'Found it. Opening the product…' });
        stopCamera();
        router.push(`/p/${result.token}`);
        return;
      }
      setStatus({ tone: 'error', text: result?.message || 'We could not match this code. Try another sticker.' });
    } catch {
      setStatus({ tone: 'error', text: 'We could not reach the catalogue. Check your internet connection and try again.' });
    }
    // Let the customer move to the next sticker without the same code firing again instantly.
    window.setTimeout(() => { lockedRef.current = false; }, 1500);
  }

  async function startCamera() {
    if (cameraOn) { stopCamera(); return; }
    setStatus({ tone: 'idle', text: '' });
    setCameraOn(true);
    lockedRef.current = false;
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!videoRef.current) throw new Error('no video surface');
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 900 });
      controlsRef.current = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        videoRef.current,
        (result) => {
          const payload = result?.getText()?.trim();
          if (payload) void open(payload);
        },
      );
    } catch (error) {
      stopCamera();
      setStatus({ tone: 'error', text: cameraProblem(error) });
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const code = manual.trim();
    if (!code) { setStatus({ tone: 'error', text: 'Type the code printed under the QR, for example LB/2026/1600-0001.' }); return; }
    lockedRef.current = false;
    void open(code);
  }

  return (
    <section aria-label="Product scanner" className="public-rise mt-6" style={{ animationDelay: '80ms' }}>
      <div className="relative mx-auto aspect-[4/5] max-h-[60vh] w-full max-w-md overflow-hidden rounded-r6 border border-[var(--line)] bg-[#141416] shadow-lg sm:aspect-square">
        <video ref={videoRef} className={`h-full w-full object-cover ${cameraOn ? '' : 'hidden'}`} muted playsInline aria-label="Camera preview" />
        {cameraOn ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
            <div className="relative h-3/5 w-3/5">
              {['left-0 top-0 border-l-4 border-t-4 rounded-tl-xl', 'right-0 top-0 border-r-4 border-t-4 rounded-tr-xl', 'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-xl', 'bottom-0 right-0 border-b-4 border-r-4 rounded-br-xl'].map((corner) => (
                <span key={corner} className={`absolute h-10 w-10 border-white ${corner}`} />
              ))}
              <span className="scan-sweep absolute inset-x-2 h-0.5 bg-[#f1aaa4] shadow-[0_0_12px_#f1aaa4]" />
            </div>
          </div>
        ) : (
          <button type="button" onClick={startCamera} className="absolute inset-0 grid place-items-center text-white">
            <span className="grid justify-items-center gap-3">
              <span className="grid h-20 w-20 place-items-center rounded-full bg-white/10"><Camera className="h-9 w-9" aria-hidden="true" /></span>
              <span className="text-lg font-semibold">Tap to start the camera</span>
              <span className="max-w-[16rem] text-sm text-white/70">Your camera is only used to read the QR code. Nothing is recorded.</span>
            </span>
          </button>
        )}
      </div>

      <div className="mx-auto mt-4 flex max-w-md flex-col gap-3">
        <p
          role="status"
          aria-live="polite"
          className={`min-h-6 text-center text-sm font-medium ${status.tone === 'error' ? 'text-[var(--danger)]' : status.tone === 'found' ? 'text-[var(--success)]' : 'text-[var(--ink-3)]'}`}
        >
          {status.tone === 'busy' ? <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin align-[-3px]" aria-hidden="true" /> : null}
          {status.text || (cameraOn ? 'Hold the sticker inside the frame.' : '')}
        </p>
        {cameraOn ? (
          <button type="button" onClick={stopCamera} className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-[var(--line-strong)] font-semibold text-[var(--ink)]">
            <CameraOff className="h-4 w-4" aria-hidden="true" />Stop camera
          </button>
        ) : (
          <button type="button" onClick={startCamera} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[var(--ink)] font-semibold text-[var(--surface)]">
            <ScanLine className="h-4 w-4" aria-hidden="true" />Start scanning
          </button>
        )}
        <form onSubmit={submit} className="rounded-r6 border border-[var(--line)] bg-[var(--surface)] p-4">
          <label htmlFor="sticker-code" className="text-sm font-semibold text-[var(--ink)]">No camera? Type the code under the QR</label>
          <div className="mt-2 flex gap-2">
            <input
              id="sticker-code"
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder="LB/2026/1600-0001"
              autoCapitalize="characters"
              autoComplete="off"
              className="h-12 min-w-0 flex-1 rounded-r4 border border-[var(--line-strong)] bg-[var(--surface)] px-3 font-mono text-base text-[var(--ink)] outline-none focus:border-[var(--brand-400)]"
            />
            <button type="submit" className="h-12 shrink-0 rounded-r4 bg-[var(--brand-600)] px-5 font-semibold text-white">Open</button>
          </div>
        </form>
      </div>
    </section>
  );
}
