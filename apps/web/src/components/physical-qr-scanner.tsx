'use client';

import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader, IScannerControls } from '@zxing/browser';
import { Camera, CameraOff, CheckCircle2, RefreshCcw, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type PhysicalQrScannerProps = {
  onDetected: (payload: string) => void | Promise<void>;
  busy?: boolean;
  compact?: boolean;
  placeholder?: string;
};

function cameraMessage(error: unknown) {
  const name = String((error as any)?.name || '');
  if (name === 'NotAllowedError') return 'Camera access was blocked. Allow Camera for this site in Safari settings, then try again.';
  if (name === 'NotFoundError') return 'No camera is available on this device.';
  if (name === 'NotReadableError') return 'The camera is already in use by another app or browser tab.';
  return 'Camera could not start. You can still use a handheld scanner or paste the printed code.';
}

export function PhysicalQrScanner({ onDetected, busy = false, compact = false, placeholder = 'Scan QR or enter its printed code…' }: PhysicalQrScannerProps) {
  const [manual, setManual] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [lastPayload, setLastPayload] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lockedRef = useRef(false);

  const stopCamera = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    if (videoRef.current?.srcObject) {
      for (const track of (videoRef.current.srcObject as MediaStream).getTracks()) track.stop();
      videoRef.current.srcObject = null;
    }
    setCameraOpen(false);
    lockedRef.current = false;
  };

  useEffect(() => () => stopCamera(), []);

  async function startCamera() {
    if (cameraOpen) return stopCamera();
    setCameraError('');
    setCameraOpen(true);
    lockedRef.current = false;
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!videoRef.current) throw new Error('Camera surface is unavailable');
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 900 });
      controlsRef.current = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        videoRef.current,
        async (result) => {
          const payload = result?.getText()?.trim();
          if (!payload || lockedRef.current) return;
          lockedRef.current = true;
          setLastPayload(payload);
          stopCamera();
          await onDetected(payload);
        },
      );
    } catch (error) {
      stopCamera();
      setCameraError(cameraMessage(error));
    }
  }

  async function submitManual() {
    const payload = manual.trim();
    if (!payload || busy) return;
    setLastPayload(payload);
    setManual('');
    await onDetected(payload);
  }

  return <div className={compact ? 'space-y-2' : 'space-y-3'}>
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative min-w-0 flex-1">
        <ScanLine className="absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]"/>
        <Input
          autoCapitalize="characters"
          autoCorrect="off"
          inputMode="text"
          value={manual}
          onChange={(event) => setManual(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitManual(); } }}
          placeholder={placeholder}
          className="pl-9"
          aria-label="Scanned QR payload or printed label code"
        />
      </div>
      <Button type="button" variant="outline" disabled={busy} onClick={startCamera} className="shrink-0">
        {cameraOpen ? <CameraOff className="mr-2 h-4 w-4"/> : <Camera className="mr-2 h-4 w-4"/>}
        {cameraOpen ? 'Close camera' : 'Scan with camera'}
      </Button>
      <Button type="button" disabled={busy || !manual.trim()} onClick={submitManual} className="shrink-0">
        <ScanLine className="mr-2 h-4 w-4"/>{busy ? 'Checking…' : 'Look up'}
      </Button>
    </div>
    {cameraOpen ? <div className="relative overflow-hidden rounded-2xl border border-emerald-300 bg-black shadow-inner">
      <video ref={videoRef} muted playsInline className={`w-full object-cover ${compact ? 'max-h-72' : 'max-h-[28rem]'}`} aria-label="Live QR scanner camera"/>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="h-44 w-44 rounded-3xl border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,.36)] sm:h-56 sm:w-56"/>
      </div>
      <p className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white">Hold the MP QR inside the frame</p>
    </div> : null}
    {cameraError ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><RefreshCcw className="mt-0.5 h-4 w-4 shrink-0"/>{cameraError}</div> : null}
    {lastPayload && !cameraOpen ? <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ink-4)]"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600"/>Last scan captured securely. The full encoded value is not repeated on screen.</p> : null}
  </div>;
}
