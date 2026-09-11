// Local-only visual harness using the actual shared selector, sticker JSX, CSS and fitter.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import path from 'node:path';
const root = process.cwd();
const out = path.join(root, 'tmp/tile-label-scan-preview');
mkdirSync(out, { recursive: true });
const source = readFileSync('apps/web/src/app/print/labels/[runId]/page.tsx', 'utf8');
const component = source.slice(source.indexOf('function FinishFourByTwoLabelV4'), source.indexOf('async function waitForPrintAssets'));
const fitter = source.slice(source.indexOf('function fitStickerText'), source.indexOf('function StandardFourByTwoLabel'));
const css = source.slice(source.indexOf('    .mp-v4-label-page {'), source.indexOf('    @media screen {')).replaceAll('${pageWidth}', '101.6').replaceAll('${pageHeight}', '50.8');
const entry = `import React,{useState,useEffect} from 'react';
import{createRoot}from'react-dom/client';
import{ScanProductSelector}from'./apps/web/src/components/scan-product-selector';
import{compactTileSize}from'@marble-park/pricing-contract/tile-size';
const money=(v)=>Number(v).toLocaleString('en-IN');
${component}\n${fitter}
const products=['1200 x 600 mm (3 PC)','1200 x 1800 mm','1200 x 2400 mm'].map((size,i)=>({id:String(i+1),category:'Tiles',sku:'ROSSO-'+(i+1),name:'ROSSO LEVANTO',tileSizeMaster:{name:size},finish:i===0?'Matt':'Glossy',available:i===2?0:4,isScannedProduct:i===0}));
const result={event:{id:'fixture'},relatedProducts:products,relatedSummary:{type:'tile_design',designName:'ROSSO LEVANTO',designCode:'ROSSO-LAV'}};
function App(){const[added,setAdded]=useState('None');const[check,setCheck]=useState('Checking layout');useEffect(()=>{document.fonts.ready.then(()=>{const error=fitStickerText();const sizes=document.querySelectorAll('.mp-v4-tile-size');setCheck(error||('PASS: six label frames fit; '+sizes.length+' tile-only size lines'));});},[]);return <main style={{padding:24,maxWidth:1200,margin:'auto'}}><h1>Local acceptance fixture — no production writes</h1><ScanProductSelector result={result} primaryLabel="Add to intent" onPrimary={p=>setAdded(p.map(x=>x.id).join(', '))}/><p role="status">Added product IDs: {added}</p><h2>{check}</h2><div style={{display:'flex',flexWrap:'wrap',gap:16}}>{[false,true].flatMap(portrait=>['ARORA ARAMANI COCO','LONG-COMPACT-PRODUCT-CODE-FOR-STICKER','ALD-CHR-079N'].map((product,i)=><FinishFourByTwoLabelV4 key={product+portrait} portrait={portrait} label={{labelCode:'LBL/2026/TEST',qrDataUrl:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/><text x="10" y="50">QR fixture</text></svg>',payload:{category:i===2?'Sanitaryware':'Tiles',dimensions:'1200 x 600 mm (3 PC)',compactProductValue:product,finish:'BRUSH HARD GRAPHITE',governedBrandCode:'1047',mrpInclusive:129999.5,priceUom:i===2?'PC':'SQFT'}}}/>))}</div></main>};createRoot(document.getElementById('root')).render(<App/>);`;
await build({stdin:{contents:entry,resolveDir:root,sourcefile:'tile-preview.tsx',loader:'tsx'},bundle:true,platform:'browser',outfile:path.join(out,'app.js'),alias:{'@':path.join(root,'apps/web/src')},define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},jsx:'automatic'});
const styles = readdirSync('apps/web/.next/static/css').filter(f=>f.endsWith('.css')).map(f=>readFileSync('apps/web/.next/static/css/'+f,'utf8')).join('\n');
writeFileSync(path.join(out,'index.html'),`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tile label and scan verification</title><style>${styles}\n${css}\n.mp-v4-label-page.is-portrait{width:50.8mm;height:101.6mm}body{background:#f7f8f8;color:#171717}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
createServer((req,res)=>{const file=req.url==='/app.js'?'app.js':'index.html';res.setHeader('Content-Type',file==='app.js'?'text/javascript':'text/html');res.end(readFileSync(path.join(out,file)));}).listen(4187,'127.0.0.1',()=>console.log('Preview http://127.0.0.1:4187'));
