const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// استفاده از حافظه رم برای آپلود (سازگار با Render)
const upload = multer({ storage: multer.memoryStorage() });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

// --- تابع کمکی: شکستن متن طولانی ---
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

  // مسیر موقت برای آپلود به گوگل (چون گوگل فایل فیزیکی می‌خواهد)
  const tempFilePath = path.join('/tmp', `upload_${Date.now()}.pdf`);

  try {
    // ذخیره فایل در پوشه موقت سیستم
    fs.writeFileSync(tempFilePath, req.file.buffer);

    console.log("1. Uploading to Google...");
    const uploadResponse = await fileManager.uploadFile(tempFilePath, {
      mimeType: "application/pdf",
      displayName: "MangaFile",
    });

    console.log("2. Analyzing with Gemini 2.5 Flash...");
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash", 
        generationConfig: { responseMimeType: "application/json" } 
    });

    // پرامپت: شناسایی دقیق کادرها + ترجمه محاوره‌ای
    const prompt = `
    Analyze this whole PDF page by page. Identify ALL speech bubbles.
    Return a JSON array where each object contains:
    1. "page_number": Integer (1-based).
    2. "text": The Persian translation.
    3. "box_2d": [ymin, xmin, ymax, xmax] (normalized 0-1000).

    🔥 RULES (PERSIAN):
    - Tone: Spoken/Colloquial (محاوره‌ای و خودمونی).
    - NO BOOKISH WORDS: Don't use "است", "آیا", "آنجا". Use "ـه", "چی", "اونجا".
    - Keep sentences short to fit the bubbles.
    `;

    const result = await model.generateContent([
      { fileData: { mimeType: uploadResponse.file.mimeType, fileUri: uploadResponse.file.uri } },
      { text: prompt }
    ]);

    const translations = JSON.parse(result.response.text());
    console.log(`✅ Found ${translations.length} dialogs.`);

    console.log("3. Generating PDF...");
    const pdfDoc = await PDFDocument.load(req.file.buffer);
    pdfDoc.registerFontkit(fontkit);
    
    const fontPath = path.join(__dirname, 'font.ttf');
    if (!fs.existsSync(fontPath)) throw new Error("فایل font.ttf یافت نشد!");
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

      // 1. محاسبه دقیق مختصات کادر اصلی (متن انگلیسی)
      const originalBoxX = (xmin / 1000) * width;
      const originalBoxY = height - ((ymax / 1000) * height); // پایینِ باکس
      const originalBoxWidth = ((xmax - xmin) / 1000) * width;
      const originalBoxHeight = ((ymax - ymin) / 1000) * height;

      // 2. تنظیمات ظاهری
      let fontSize = 10;
      if (item.text.length > 60) fontSize = 9;
      if (item.text.length > 100) fontSize = 8;

      // پدینگ اضافه برای پوشاندن کامل متن زیرین
      const coverPadding = 3; 

      // 3. رسم کادر سفید یکدست (Solid White Patch)
      // این مثل لاک غلط‌گیر عمل می‌کند
      currentPage.drawRectangle({
        x: originalBoxX - coverPadding,
        y: originalBoxY - coverPadding,
        width: originalBoxWidth + (coverPadding * 2),
        height: originalBoxHeight + (coverPadding * 2),
        color: rgb(1, 1, 1), // سفید خالص
        borderWidth: 0,      // بدون هیچ حاشیه‌ای
        opacity: 1.0,        // کاملاً کدر (متن زیر را می‌پوشاند)
      });

      // 4. محاسبه متن برای وسط‌چین شدن
      // عرض مفید برای متن (کمی کمتر از عرض باکس)
      const effectiveWidth = Math.max(originalBoxWidth - 4, 40); 
      
      let textLines = wrapText(item.text, customFont, fontSize, effectiveWidth);
      
      // محاسبه ارتفاع کل متن
      const totalTextHeight = textLines.length * (fontSize * 1.3); 

      // محاسبه نقطه شروع عمودی (برای وسط‌چین کردن در ارتفاع باکس)
      let currentTextY = originalBoxY + (originalBoxHeight / 2) + (totalTextHeight / 2) - fontSize;

      // 5. نوشتن متن
      for (const line of textLines) {
        const lineWidth = customFont.widthOfTextAtSize(line, fontSize);
        // محاسبه نقطه شروع افقی (برای وسط‌چین کردن در عرض باکس)
        const centeredX = originalBoxX + (originalBoxWidth - lineWidth) / 2;
        
        currentPage.drawText(line, {
          x: centeredX,
          y: currentTextY,
          size: fontSize,
          font: customFont,
          color: rgb(0, 0, 0), // متن سیاه
        });
        currentTextY -= (fontSize * 1.3); // رفتن به خط بعدی
      }
    }

    const pdfBytes = await pdfDoc.save();

    // پاک کردن فایل موقت
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    // ارسال مستقیم بافر به کاربر (بدون ذخیره روی دیسک سرور)
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=translated_manga.pdf');
    res.setHeader('Content-Length', pdfBytes.length);
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error("❌ Error:", error);
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));