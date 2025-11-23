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

// ✅ تغییر مهم 1: استفاده از حافظه رم به جای هارد
const upload = multer({ storage: multer.memoryStorage() });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

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

  // مسیر موقت برای ورودی (گوگل نیاز به فایل فیزیکی دارد)
  const tempFilePath = path.join('/tmp', `upload_${Date.now()}.pdf`);

  try {
    // نوشتن فایل ورودی در پوشه موقت
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

    // پرامپت محاوره‌ای شما
    const prompt = `
    Analyze this whole PDF. Identify all speech bubbles.
    Return a JSON array where each object contains:
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
    // لود کردن PDF از بافر حافظه
    const pdfDoc = await PDFDocument.load(req.file.buffer);
    pdfDoc.registerFontkit(fontkit);
    
    const fontPath = path.join(__dirname, 'font.ttf');
    if (!fs.existsSync(fontPath)) throw new Error("font.ttf یافت نشد!");
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

      const originalBoxX = (xmin / 1000) * width;
      const originalBoxWidth = ((xmax - xmin) / 1000) * width;
      const newBoxWidth = Math.max(originalBoxWidth, 110);
      
      const fontSize = 10;
      const padding = 10;
      const textLines = wrapText(item.text, customFont, fontSize, newBoxWidth - (padding * 2));
      const newBoxHeight = (textLines.length * fontSize * 1.4) + (padding * 2);
      
      const originalBoxY = height - ((ymax / 1000) * height);
      let newBoxY = originalBoxY - 5;

      currentPage.drawRectangle({
        x: originalBoxX,
        y: newBoxY - newBoxHeight + fontSize,
        width: newBoxWidth,
        height: newBoxHeight,
        color: rgb(1, 1, 1),
        borderColor: rgb(0, 0, 0),
        borderWidth: 1.5,
        opacity: 0.95,
      });

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
        currentTextY -= (fontSize * 1.4);
      }
    }

    // تولید فایل نهایی به صورت بافر
    const pdfBytes = await pdfDoc.save();

    // پاک کردن فایل موقت ورودی
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    console.log("4. Sending Buffer directly...");
    
    // ✅ تغییر مهم 2: ارسال مستقیم بافر به کاربر (بدون ذخیره روی دیسک سرور)
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