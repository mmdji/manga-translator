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

const upload = multer({ storage: multer.memoryStorage() });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

// --- تابع کمکی: شکستن متن ---
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

// --- تابع جدید: بررسی تداخل دو مستطیل ---
function isOverlapping(rect1, rect2) {
  return (
    rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y
  );
}

app.post('/api/translate', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایلی ارسال نشد.' });

  const tempFilePath = path.join('/tmp', `upload_${Date.now()}.pdf`);

  try {
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

    // 🔥 پرامپت بهبود یافته برای شناسایی دقیق‌تر
    const prompt = `
    Analyze this whole PDF page by page. 
    **Task:** Detect ALL speech bubbles, including small SFX text and background dialogs. Do not miss any text.
    
    Return a JSON array where each object contains:
    1. "page_number": Integer (1-based).
    2. "text": Persian translation (Casual/Conversational).
    3. "box_2d": [ymin, xmin, ymax, xmax] (normalized 0-1000).

    **Rules:**
    - If text is dense, translate it concisely.
    - Be extremely precise with bounding boxes.
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
    if (!fs.existsSync(fontPath)) throw new Error("font.ttf یافت نشد!");
    const fontBytes = fs.readFileSync(fontPath); 
    const customFont = await pdfDoc.embedFont(fontBytes);
    const pages = pdfDoc.getPages();

    // آرایه برای ذخیره مکان باکس‌های رسم شده در هر صفحه (برای جلوگیری از تداخل)
    const drawnBoxes = {}; // Key: pageIndex, Value: Array of rects

    for (const item of translations) {
      if (!item.box_2d || !item.text || !item.page_number) continue;
      const pageIndex = item.page_number - 1;
      if (pageIndex >= pages.length) continue;
      
      if (!drawnBoxes[pageIndex]) drawnBoxes[pageIndex] = [];

      const currentPage = pages[pageIndex];
      const { width, height } = currentPage.getSize();
      const [ymin, xmin, ymax, xmax] = item.box_2d;

      const originalBoxX = (xmin / 1000) * width;
      const originalBoxWidth = ((xmax - xmin) / 1000) * width;
      const originalBoxY = height - ((ymax / 1000) * height);
      
      // ✅ 1. هوشمندسازی سایز باکس و فونت
      let fontSize = 10;
      let padding = 8;
      // اگر عرض خیلی کم بود، حداقل عرض را بیشتر می‌گیریم
      let newBoxWidth = Math.max(originalBoxWidth, 120); 
      
      // اگر متن طولانی بود، فونت را کمی کوچک کن
      if (item.text.length > 50) fontSize = 9;
      if (item.text.length > 100) fontSize = 8;

      let textLines = wrapText(item.text, customFont, fontSize, newBoxWidth - (padding * 2));
      let contentHeight = (textLines.length * fontSize * 1.4) + (padding * 2);
      
      // ✅ 2. جلوگیری از تداخل (Collision Avoidance)
      // ابتدا سعی می‌کنیم باکس را پایین باکس اصلی بگذاریم
      let newBoxY = originalBoxY - 5; 
      let finalBoxY = newBoxY - contentHeight + fontSize;

      let currentRect = {
        x: originalBoxX,
        y: finalBoxY, // در pdf-lib مختصات Y از پایین صفحه است
        width: newBoxWidth,
        height: contentHeight
      };

      // چک کردن تداخل با باکس‌های قبلی در همان صفحه
      let overlapFound = true;
      let attempts = 0;
      
      while (overlapFound && attempts < 5) {
        overlapFound = false;
        for (const existingBox of drawnBoxes[pageIndex]) {
          if (isOverlapping(currentRect, existingBox)) {
            overlapFound = true;
            // اگر تداخل داشت، باکس را کمی پایین‌تر می‌بریم
            currentRect.y -= (existingBox.height + 5); 
            break; 
          }
        }
        attempts++;
      }

      // ذخیره مختصات نهایی برای بررسی‌های بعدی
      drawnBoxes[pageIndex].push(currentRect);

      // رسم کادر نهایی
      currentPage.drawRectangle({
        x: currentRect.x,
        y: currentRect.y,
        width: currentRect.width,
        height: currentRect.height,
        color: rgb(1, 1, 1),
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
        opacity: 0.95,
      });

      // نوشتن متن
      let currentTextY = currentRect.y + currentRect.height - padding - fontSize;
      for (const line of textLines) {
        const lineWidth = customFont.widthOfTextAtSize(line, fontSize);
        const centeredX = currentRect.x + (currentRect.width - lineWidth) / 2;
        
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