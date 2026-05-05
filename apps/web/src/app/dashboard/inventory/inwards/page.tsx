'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { motion } from 'framer-motion';
import { CheckCircle2, FileSpreadsheet, PackagePlus, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PROCESS_PDF_IMPORT = gql`
  mutation ProcessPdfImport($filePath: String!) { processPdfImport(filePath: $filePath) { id result } }
`;
const PROCESS_EXCEL_IMPORT = gql`
  mutation ProcessExcelImport($filePath: String!) { processExcelImport(filePath: $filePath) { id result } }
`;
const GET_VENDORS = gql`
  query Vendors { vendors(status: "active", take: 60) }
`;

export default function InventoryInwardsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [vendorId, setVendorId] = useState('');
  const { data: vendorData } = useQuery(GET_VENDORS);
  const [processPdfImport] = useMutation(PROCESS_PDF_IMPORT);
  const [processExcelImport] = useMutation(PROCESS_EXCEL_IMPORT);
  const vendors = vendorData?.vendors || [];

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!response.ok) throw new Error('Upload failed');
      const { filePath } = await response.json();
      const isExcel = /\.xlsx?$/i.test(file.name);
      const mutationResult = isExcel
        ? await processExcelImport({ variables: { filePath } })
        : await processPdfImport({ variables: { filePath } });
      setResult({
        vendor: vendors.find((vendor: any) => vendor.id === vendorId) || null,
        ...(isExcel ? mutationResult.data?.processExcelImport?.result : mutationResult.data?.processPdfImport?.result),
      });
    } catch (error: any) {
      setResult({ error: error.message || 'Import failed' });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-7 pb-10">
      <section className="rounded-[2.25rem] bg-[#211b16] p-7 text-white shadow-2xl shadow-[#211b16]/15">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#e8c39b]">Inward and import</p>
            <h1 className="mt-3 text-5xl font-black tracking-[-0.05em]">Bring vendor catalogues into stock control.</h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-[#d9c4a9]">Excel imports create catalogue SKUs directly. PDF imports extract deterministic text first and can fall back to review queues.</p>
          </div>
          <PackagePlus className="h-12 w-12 text-[#e8c39b]" />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="mp-card rounded-[2rem] p-6">
          <div className="grid h-16 w-16 place-items-center rounded-3xl bg-[#ead7c0] text-[#7a4f2e]"><FileSpreadsheet className="h-8 w-8" /></div>
          <h2 className="mt-6 text-3xl font-black tracking-tight">Supported imports</h2>
          <div className="mt-5 space-y-3 text-sm font-bold text-[#5f4b3b]">
            <p className="rounded-2xl bg-white/60 p-4">Excel: Grohe, Hansgrohe, Hindware and other tabular price lists.</p>
            <p className="rounded-2xl bg-white/60 p-4">PDF: searchable catalogues, product text extraction and review summary.</p>
            <p className="rounded-2xl bg-white/60 p-4">Stock: imported catalogue SKUs start at zero stock until received.</p>
            <p className="rounded-2xl bg-white/60 p-4">Vendor master: choose the supplier before import so purchase and catalogue responsibility is clear.</p>
          </div>
        </div>

        <div className="mp-card rounded-[2rem] p-6">
          <label className="mb-5 block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-[#8b6b4c]">Vendor master</span>
            <select value={vendorId} onChange={(event) => setVendorId(event.target.value)} className="h-12 w-full rounded-2xl border border-[#7a5b3c]/15 bg-white px-4 text-sm font-black text-[#211b16]">
              <option value="">Select vendor for this import</option>
              {vendors.map((vendor: any) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
          </label>
          <label className="group relative grid min-h-[330px] cursor-pointer place-items-center overflow-hidden rounded-[2rem] border-2 border-dashed border-[#7a5b3c]/22 bg-white/60 p-8 text-center transition hover:bg-white">
            <input type="file" accept=".pdf,.xlsx,.xls" className="absolute inset-0 opacity-0" onChange={(event) => setFile(event.target.files?.[0] || null)} disabled={isUploading} />
            <div>
              <motion.div animate={{ y: file ? -4 : 0 }} className="mx-auto grid h-20 w-20 place-items-center rounded-[1.75rem] bg-[#211b16] text-[#fffaf3] shadow-2xl"><UploadCloud className="h-9 w-9" /></motion.div>
              <h3 className="mt-6 text-3xl font-black tracking-tight">{file ? file.name : 'Drop catalogue file here'}</h3>
              <p className="mx-auto mt-3 max-w-md text-sm font-semibold leading-6 text-[#7d6b5c]">Choose an Excel or searchable PDF catalogue. The backend will normalize rows into product master data.</p>
            </div>
          </label>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button onClick={handleUpload} disabled={!file || isUploading} size="lg" className="gap-2"><UploadCloud className="h-5 w-5" /> {isUploading ? 'Processing...' : 'Process import'}</Button>
            {file && <span className="text-sm font-bold text-[#7d6b5c]">{Math.round(file.size / 1024).toLocaleString('en-IN')} KB</span>}
          </div>

          {result && (
            <div className="mt-5 rounded-[1.5rem] bg-[#dbe8e3] p-5 text-[#24544d]">
              <div className="flex items-center gap-2 font-black"><CheckCircle2 className="h-5 w-5" /> Import result</div>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs font-bold leading-5 custom-scrollbar">{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
