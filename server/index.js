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

// استفاده از حافظه رم برای سرعت بالا
const upload = multer({ storage: multer.memoryStorage() });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

// تابع شکستن متن (Word Wrapping)
function wrapText(text, font, fontSize, maxWidth) {
  if (!text) return ["..."];
  const words = text.split(' ');
  let lines = [];
  let currentLine = words[0];
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = font.widthOfTextAtSize(currentLine + " " + word, fontSize);
    if (width < maxWidth) currentLine += " " + word;
    else { lines.push(currentLine); currentLine = word; }
  }
  lines.push(currentLine);
  return lines;
}

app.post('/api/translate', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایلی ارسال نشد.' });

  // دریافت استایل ترجمه از فرانت (پیش‌فرض: محاوره‌ای)
  const translationMode = req.body.mode || 'casual';
  console.log(`🔄 Translation Strategy: ${translationMode}`);

  const tempFilePath = path.join('/tmp', `upload_${Date.now()}.pdf`);

  try {
    fs.writeFileSync(tempFilePath, req.file.buffer);

    console.log("1. Uploading PDF to Gemini Banana...");
    const uploadResponse = await fileManager.uploadFile(tempFilePath, {
      mimeType: "application/pdf",
      displayName: "MangaFile",
    });

    console.log("2. Analyzing Page-by-Page with 'nano-banana-pro-preview'...");
    
    // 👇👇👇 استفاده از مدل خاص بنانا 👇👇👇
    const model = genAI.getGenerativeModel({ 
        model: "nano-banana-pro-preview", 
        generationConfig: { responseMimeType: "application/json" } 
    });

    // پرامپت متمرکز بر ترجمه محاوره‌ای و آنالیز تصویری
    const baseInstruction = `
    You are an expert Manga Localizer. 
    Analyze this PDF file visually, page by page.
    
    **MISSION:**
    1. Detect ALL speech bubbles using Vision capabilities.
    2. Extract the bounding box EXACTLY covering the original text.
    3. Translate the text into **Natural Spoken Persian (Farsi)**.
    
    **TRANSLATION RULES (CRITICAL):**
    - Tone: **Conversational & Colloquial** (زبان محاوره‌ای و گفتاری).
    - Do NOT use bookish words (e.g., replace "است" with "ـه", "آیا" with tone change).
    - Capture the character's emotion (Shouting, Whispering, Sarcasm).
    - If the text is SFX (Sound Effect), keep it or translate it phonetically.

    Return a JSON array of objects:
    {
      "page_number": Integer (1-based),
      "text": "Persian Translation",
      "box_2d": [ymin, xmin, ymax, xmax] (normalized 0-1000)
    }
    `;

    // تنظیمات اضافه بر اساس مود انتخابی کاربر
    let modeRules = "";
    if (translationMode === 'formal') {
        modeRules = "NOTE: Keep the grammar slightly more standard but still fluent (Like official subtitles).";
    } else {
        modeRules = "NOTE: Go full casual/slang! Make it sound like a cool dub.";
    }

    const result = await model.generateContent([
      { fileData: { mimeType: uploadResponse.file.mimeType, fileUri: uploadResponse.file.uri } },
      { text: baseInstruction + modeRules }
    ]);

    const translations = JSON.parse(result.response.text());
    console.log(`✅ Extracted ${translations.length} segments.`);

    console.log("3. Reconstructing PDF...");
    const pdfDoc = await PDFDocument.load(req.file.buffer);
    pdfDoc.registerFontkit(fontkit);
    
    const fontPath = path.join(__dirname, 'font.ttf');
    if (!fs.existsSync(fontPath)) throw new Error("فایل فونت یافت نشد!");
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

      // تبدیل مختصات
      const boxX = (xmin / 1000) * width;
      const boxY = height - ((ymax / 1000) * height);
      const boxWidth = ((xmax - xmin) / 1000) * width;
      const boxHeight = ((ymax - ymin) / 1000) * height;

      // 👇 رسم لکه سفید (White-out) برای پاک کردن متن اصلی
      // پدینگ 4 پیکسل برای اطمینان از پوشش کامل
      const coverPadding = 4; 
      currentPage.drawRectangle({
        x: boxX - coverPadding,
        y: boxY - coverPadding,
        width: boxWidth + (coverPadding * 2),
        height: boxHeight + (coverPadding * 2),
        color: rgb(1, 1, 1), // سفید خالص
        borderWidth: 0,      // بدون حاشیه
        opacity: 1.0,        // کاملاً کدر
      });

      // 👇 جایگذاری متن فارسی (Auto-Fit)
      let fontSize = 14; // شروع با سایز استاندارد مانگا
      let textLines = [];
      let textHeight = 0;
      const writableWidth = boxWidth + 2; 

      // کاهش سایز فونت تا زمانی که جا شود
      while (fontSize > 6) {
        textLines = wrapText(item.text, customFont, fontSize, writableWidth);
        textHeight = textLines.length * (fontSize * 1.3); // 1.3 فاصله خطوط
        if (textHeight <= boxHeight + 10) break; // +10 ارفاق
        fontSize -= 0.5;
      }

      // محاسبه موقعیت وسط‌چین
      let currentTextY = boxY + (boxHeight / 2) + (textHeight / 2) - fontSize + 2;

      for (const line of textLines) {
        const lineWidth = customFont.widthOfTextAtSize(line, fontSize);
        const centeredX = boxX + (boxWidth - lineWidth) / 2;
        
        currentPage.drawText(line, {
          x: centeredX,
          y: currentTextY,
          size: fontSize,
          font: customFont,
          color: rgb(0, 0, 0), // متن مشکی
        });
        currentTextY -= (fontSize * 1.3);
      }
    }

    const pdfBytes = await pdfDoc.save();

    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

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