import React, { useState } from 'react';
import axios from 'axios';
import { Upload, Loader2, Download, FileText } from 'lucide-react';

// ⚡️ تنظیم آدرس سرور
// برای لوکال: http://localhost:5000
// برای سرور واقعی: آدرس سرور خود را اینجا بگذارید (مثلا https://my-manga-api.onrender.com)
const API_URL = 'http://localhost:5000'; 

function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post(`${API_URL}/api/translate`, formData, {
        responseType: 'blob', // دریافت باینری فایل
      });

      // دانلود خودکار
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `FA_${file.name}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
    } catch (err) {
      console.error(err);
      setError('خطا در ارتباط با سرور یا پردازش فایل.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4 font-[Vazirmatn]">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-5xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500 mb-2 drop-shadow-lg">
          MANGA AI
        </h1>
        <p className="text-slate-400 tracking-widest uppercase text-sm">
          ترجمه هوشمند مانگا با استایل کمیک
        </p>
      </div>

      {/* Upload Box */}
      <div className="bg-slate-800/50 backdrop-blur-lg p-8 rounded-3xl border border-slate-700 text-center w-full max-w-md shadow-2xl hover:border-cyan-500/50 transition-all duration-300">
        
        <div 
          className="border-2 border-dashed border-slate-600 rounded-2xl p-8 cursor-pointer hover:bg-slate-700/50 transition-colors group"
          onClick={() => document.getElementById('fileInput').click()}
        >
          <input 
            type="file" 
            id="fileInput"
            accept=".pdf"
            onChange={(e) => setFile(e.target.files[0])} 
            className="hidden"
          />
          
          <div className="flex flex-col items-center gap-4">
            {file ? (
              <FileText className="w-16 h-16 text-cyan-400 animate-bounce" />
            ) : (
              <Upload className="w-16 h-16 text-slate-500 group-hover:text-white transition-colors" />
            )}
            <span className="text-lg font-medium text-slate-300">
              {file ? file.name : "فایل PDF را اینجا رها کنید"}
            </span>
          </div>
        </div>
        
        {error && (
          <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 text-red-200 rounded-xl text-sm">
            {error}
          </div>
        )}

        <button 
          onClick={handleUpload} 
          disabled={loading || !file}
          className={`w-full mt-6 py-4 rounded-xl font-bold text-xl flex justify-center items-center gap-3 transition-all
            ${loading || !file 
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
              : 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:shadow-lg hover:shadow-cyan-500/30 hover:-translate-y-1'
            }`}
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" /> در حال ترجمه...
            </>
          ) : (
            <>
              <Download /> دریافت فایل ترجمه شده
            </>
          )}
        </button>
      </div>
      
      <footer className="mt-12 text-slate-600 text-xs">
        Powered by Gemini 2.5 Flash • 2025
      </footer>
    </div>
  );
}

export default App;