const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

// --- بخش پروکسی (برای سرور ابری نیازی نیست / برای لوکال ایران کامنت را بردارید) ---
/*
const { setGlobalDispatcher, ProxyAgent } = require("undici"); 
// تنظیمات پروکسی برای لوکال
const PROXY_URL = "http://127.0.0.1:2080"; // پورت خود را چک کنید
try {
  const dispatcher = new ProxyAgent({ 
    uri: PROXY_URL, 
    connect: { rejectUnauthorized: false, timeout: 300000 } 
  }); 
  setGlobalDispatcher(dispatcher);
  console.log(`🚀 Local Proxy Active: ${PROXY_URL}`);
} catch (e) { console.error("Proxy error:", e); }
*/
// --------------------------------------------------------------------------

require('dotenv').config();

const app = express();
// پورت داینامیک برای سرورهای ابری (Render/Heroku)
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// پوشه آپلود موقت
const upload = multer({ dest: '/tmp/' }); // در سرورهای ابری معمولاً /tmp بهتر است
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

// تابع کمکی برای شکستن متن
function wrapText(text, font, fontSize, maxWidth) {
  if (!text) return ["..."];
  const words = text.split(' ');
  let lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = font.widthOfTextAtSize(currentLine + " " + word, fontSize);
    if (width < maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

app.post('/api/translate', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایلی ارسال نشد.' });

  try {
    console.log("1. Uploading to Google...");
    const uploadResponse = await fileManager.uploadFile(req.file.path, {
      mimeType: "application/pdf",
      displayName: req.file.originalname,
    });

    console.log("2. Analyzing with Gemini 2.5 Flash...");
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash", 
        generationConfig: { responseMimeType: "application/json" } 
    });

    // پرامپت ترجمه محاوره‌ای
    const prompt = `
    Analyze this whole PDF. Identify all speech bubbles.
    Return a JSON array. Each object must contain:
    1. "page_number": Integer (1-based).
    2. "text": The Persian translation.
    3. "box_2d": [ymin, xmin, ymax, xmax] (normalized 0-1000).

    🔥 TRANSLATION RULES (Persian/Farsi):
    - Tone: Casual, Spoken, Anime Subtitle Style (محاوره‌ای و روان).
    - No formal language (e.g., use "میرم" not "می‌روم").
    - Keep it polite but natural.
    `;

    const result = await model.generateContent([
      { fileData: { mimeType: uploadResponse.file.mimeType, fileUri: uploadResponse.file.uri } },
      { text: prompt }
    ]);

    const translations = JSON.parse(result.response.text());
    console.log(`✅ Found ${translations.length} dialogs.`);

    console.log("3. Generating PDF...");
    const originalPdfBytes = fs.readFileSync(req.file.path);
    const pdfDoc = await PDFDocument.load(originalPdfBytes);
    
    pdfDoc.registerFontkit(fontkit);
    
    // چک کردن فونت
    const fontPath = path.join(__dirname, 'font.ttf');
    if (!fs.existsSync(fontPath)) throw new Error("فایل font.ttf پیدا نشد!");
    
    const fontBytes = fs.readFileSync(fontPath); 
    const customFont = await pdfDoc.embedFont(fontBytes);
    const pages = pdfDoc.getPages();

    for (const item of translations) {
      if (!item.box_2d || !item.text || !item.page_number) continue;

      const pageIndex = item.page_number - 1;
      if (pageIndex >= pages.length) continue;
      
      const currentPage = pages[pageIndex];
      const { width, height } = currentPage.getSize();
      const [ymin, xmin, ymax, xmax] = item.box_2d;

      // محاسبات باکس
      const originalBoxX = (xmin / 1000) * width;
      const originalBoxY = height - ((ymax / 1000) * height);
      const originalBoxWidth = ((xmax - xmin) / 1000) * width;

      // تنظیمات ظاهری
      const fontSize = 10;
      const padding = 10;
      const lineHeight = fontSize * 1.4;
      const newBoxWidth = Math.max(originalBoxWidth, 110); // حداقل عرض
      
      const textLines = wrapText(item.text, customFont, fontSize, newBoxWidth - (padding * 2));
      const contentHeight = textLines.length * lineHeight;
      const newBoxHeight = contentHeight + (padding * 2);

      // مکان باکس (کمی پایین‌تر از متن اصلی برای عدم تداخل)
      let newBoxY = originalBoxY - 5;

      // رسم کادر
      currentPage.drawRectangle({
        x: originalBoxX,
        y: newBoxY - newBoxHeight + fontSize, 
        width: newBoxWidth,
        height: newBoxHeight,
        color: rgb(1, 1, 1), // سفید
        borderColor: rgb(0, 0, 0), // حاشیه مشکی
        borderWidth: 1.5,
        opacity: 0.95,
      });

      // نوشتن متن
      let currentTextY = newBoxY - padding;
      for (const line of textLines) {
        const lineWidth = customFont.widthOfTextAtSize(line, fontSize);
        const centeredX = originalBoxX + (newBoxWidth - lineWidth) / 2;
        currentPage.drawText(line, {
          x: centeredX,
          y: currentTextY,
          size: fontSize,
          font: customFont,
          color: rgb(0, 0, 0),
        });
        currentTextY -= lineHeight;
      }
    }

    const pdfBytes = await pdfDoc.save();
    
    // ذخیره موقت و ارسال
    // استفاده از /tmp برای سازگاری با سرورهای Read-only
    const tempFilePath = path.join('/tmp', `translated_${Date.now()}.pdf`);
    
    // اگر روی ویندوز (لوکال) هستید، مسیر tmp ممکن است ارور دهد. این شرط هندل می‌کند:
    const finalPath = process.platform === 'win32' 
        ? path.join(__dirname, 'uploads', `translated_${Date.now()}.pdf`)
        : tempFilePath;

    fs.writeFileSync(finalPath, pdfBytes);

    // پاک کردن فایل ورودی
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.download(finalPath, 'Manga_Translated.pdf', () => {
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
    });

  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));