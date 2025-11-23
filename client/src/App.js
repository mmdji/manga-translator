import React, { useState } from 'react';
import axios from 'axios';
import { Upload, Loader2, Download } from 'lucide-react';

const API_URL = 'https://manga-translator-ib1b.onrender.com';

const MangaJiLogo = ({ className = "", size = "text-5xl md:text-7xl" }) => (
  <div className={`relative select-none flex items-center justify-center ${className}`} style={{ fontFamily: 'sans-serif' }}>
    <div className="relative mr-1">
      <span className={`${size} font-black absolute -top-[2px] -left-[2px] text-red-600 opacity-70 mix-blend-screen blur-[1px]`}>MANGA</span>
      <span className={`${size} font-black absolute top-[2px] left-[2px] text-blue-600 opacity-70 mix-blend-screen blur-[1px]`}>MANGA</span>
      <span className={`${size} font-black relative text-white z-10 tracking-tighter drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]`}>MANGA</span>
    </div>
    <div className="relative">
       <span className={`${size} font-black absolute -top-[2px] -left-[2px] text-purple-600 opacity-80 blur-[2px]`}>JI</span>
       <span className={`${size} font-black relative text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500 z-10 tracking-tighter drop-shadow-[0_0_15px_rgba(168,85,247,0.6)]`}>JI</span>
    </div>
  </div>
);

function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles?.length > 0) {
      const droppedFile = droppedFiles[0];
      droppedFile.type === 'application/pdf' ? setFile(droppedFile) : setError('لطفاً فقط فایل PDF انتخاب کنید.');
    }
  };

  const handleFileSelect = (e) => { setFile(e.target.files[0]); setError(''); };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post(`${API_URL}/api/translate`, formData, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `FA_${file.name}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) { console.error(err); setError('خطا در ارتباط با سرور یا پردازش فایل.'); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 font-[Vazirmatn] overflow-hidden">
      
      <div className="text-center mb-12 relative z-10">
        <div className="absolute -inset-10 bg-gradient-to-r from-cyan-600/30 via-purple-600/30 to-pink-600/30 rounded-full blur-3xl opacity-30 -z-10 animate-pulse"></div>
        <MangaJiLogo className="mb-4" />
        <p className="text-slate-300 tracking-[0.2em] uppercase text-sm md:text-base font-bold bg-slate-900/50 py-2 px-4 rounded-full inline-block backdrop-blur-sm border border-slate-700/50">
          ترجمه هوشمند مانگا با استایل کمیک
        </p>
      </div>

      <div 
        className={`bg-slate-900/60 backdrop-blur-2xl p-8 rounded-[2.5rem] border-2 text-center w-full max-w-xl shadow-2xl transition-all duration-500 relative z-10 ${
          isDragging ? 'border-cyan-400 shadow-[0_0_50px_rgba(6,182,212,0.4)] scale-105' : 'border-slate-700/80 hover:border-slate-600 shadow-[0_0_30px_rgba(0,0,0,0.5)]'
        }`}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
      >
        <div 
          className="border-4 border-dashed border-slate-700/60 rounded-3xl p-12 cursor-pointer hover:bg-slate-800/40 transition-colors group relative overflow-hidden"
          onClick={() => document.getElementById('fileInput').click()}
        >
          <input type="file" id="fileInput" accept=".pdf" onChange={handleFileSelect} className="hidden" />
          
          <div className="flex flex-col items-center gap-8 z-10 relative">
            {file ? (
              <div className="animate-bounce-slow">
                 <MangaJiLogo size="text-4xl" />
              </div>
            ) : (
              <Upload className="w-24 h-24 text-slate-600 group-hover:text-cyan-400 transition-all duration-300 group-hover:scale-110 group-hover:rotate-12" />
            )}
            
            <div className="space-y-3">
              {/* تغییر متن برای موبایل و دسکتاپ */}
              <span className={`text-xl font-bold block transition-colors ${file ? 'text-cyan-300' : 'text-slate-200'}`}>
                {file ? file.name : "انتخاب فایل PDF مانگا"}
              </span>
              {!file && (
                <span className="text-sm text-slate-400 block bg-slate-800/70 px-4 py-2 rounded-full">
                  (یا فایل را اینجا رها کنید)
                </span>
              )}
            </div>
          </div>
        </div>
        
        {error && (
          <div className="mt-6 p-4 bg-red-950/40 border-r-4 border-red-500 text-red-200 rounded-l-xl text-sm font-bold text-right backdrop-blur-sm animate-shake">
            {error}
          </div>
        )}

        {/* اصلاح دکمه: رنگ سفید اجباری و چیدمان RTL */}
        <button 
          onClick={handleUpload} 
          disabled={loading || !file}
          className={`w-full mt-8 py-5 rounded-2xl font-black text-xl flex justify-center items-center gap-3 transition-all duration-300 relative overflow-hidden text-white
            ${loading || !file 
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-80' 
              : 'bg-gradient-to-r from-cyan-500 via-blue-600 to-purple-700 shadow-[0_5px_25px_rgba(6,182,212,0.4)] hover:shadow-[0_10px_40px_rgba(168,85,247,0.5)] hover:-translate-y-1 active:translate-y-0 active:scale-[0.98]'
            }`}
        >
          {/* چیدمان RTL برای لودینگ */}
          {loading ? (
             <div className="flex flex-row-reverse items-center gap-3">
               <span className="text-white">...در حال پردازش</span>
               <Loader2 className="animate-spin w-7 h-7 text-white" />
             </div>
          ) : (
             <div className="flex items-center gap-3">
               <Download className="w-7 h-7" /> شروع ترجمه و دانلود
             </div>
          )}
        </button>
      </div>
      
      <footer className="mt-16 text-slate-500 text-sm font-medium z-10 relative">
        Powered by <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500 font-black">Gemini AI</span> • 2025
      </footer>
    </div>
  );
}

export default App;