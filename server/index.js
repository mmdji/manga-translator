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

  const translationMode = req.body.mode || 'casual';
  console.log(`🔄 Mode: ${translationMode} | Model: Gemini 2.5 PRO`);

  const tempFilePath = path.join('/tmp', `upload_${Date.now()}.pdf`);

  try {
    fs.writeFileSync(tempFilePath, req.file.buffer);

    console.log("1. Uploading to Google...");
    const uploadResponse = await fileManager.uploadFile(tempFilePath, {
      mimeType: "application/pdf",
      displayName: "MangaFile",
    });

    console.log("2. Analyzing with Gemini 2.5 PRO (High Precision)...");
    
    // 👇👇👇 تغییر به مدل قدرتمند PRO 👇👇👇
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash", // تغییر نام مدل
        generationConfig: { responseMimeType: "application/json" } 
    });

    const baseInstruction = `
    Analyze this PDF page by page. 
    **CRITICAL TASK:** Detect speech bubbles with PIXEL-PERFECT ACCURACY.
    
    Return JSON:
    1. "page_number": Integer.
    2. "text": Persian translation.
    3. "box_2d": [ymin, xmin, ymax, xmax] (0-1000). 
       **IMPORTANT:** The box MUST cover the original text completely.
    `;

    let specificRules = translationMode === 'formal' 
      ? `🔥 MODE: FAITHFUL (دقیق و روان) - Natural spoken grammar, no bookish words.` 
      : `🔥 MODE: COOL (باحال و آزاد) - Anime Fan-sub style, punchy & emotional.`;

    const result = await model.generateContent([
      { fileData: { mimeType: uploadResponse.file.mimeType, fileUri: uploadResponse.file.uri } },
      { text: baseInstruction + specificRules }
    ]);

    const translations = JSON.parse(result.response.text());
    console.log(`✅ Found ${translations.length} dialogs.`);

    console.log("3. Generating PDF...");
    const pdfDoc = await PDFDocument.load(req.file.buffer);
    pdfDoc.registerFontkit(fontkit);
    
    const fontPath = path.join(__dirname, 'font.ttf');
    if (!fs.existsSync(fontPath)) throw new Error("font.ttf not found!");
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
      const originalBoxY = height - ((ymax / 1000) * height);
      const originalBoxWidth = ((xmax - xmin) / 1000) * width;
      const originalBoxHeight = ((ymax - ymin) / 1000) * height;

      // 👇 چون مدل پرو دقیق است، پدینگ را کمی کمتر می‌کنیم تا ظریف‌تر شود
      // (البته هنوز مقداری لازم است تا مطمئن شویم متن انگلیسی کاملا محو شود)
      const coverPadding = 4; 

      // رسم کادر سفید یکدست (Solid White)
      currentPage.drawRectangle({
        x: originalBoxX - coverPadding,
        y: originalBoxY - coverPadding,
        width: originalBoxWidth + (coverPadding * 2),
        height: originalBoxHeight + (coverPadding * 2),
        color: rgb(1, 1, 1),
        borderWidth: 0,
        opacity: 1.0, 
      });

      // الگوریتم فیت کردن متن
      let fontSize = 13; // شروع با فونت کمی درشت‌تر برای خوانایی
      let textLines = [];
      let textHeight = 0;
      const writableWidth = originalBoxWidth + (coverPadding); 

      while (fontSize > 6) {
        textLines = wrapText(item.text, customFont, fontSize, writableWidth);
        textHeight = textLines.length * (fontSize * 1.3);
        if (textHeight <= originalBoxHeight + (coverPadding * 2) + 5) break; 
        fontSize -= 0.5;
      }

      let currentTextY = originalBoxY + (originalBoxHeight / 2) + (textHeight / 2) - fontSize + 1;

      for (const line of textLines) {
        const lineWidth = customFont.widthOfTextAtSize(line, fontSize);
        const centeredX = originalBoxX + (originalBoxWidth - lineWidth) / 2;
        
        currentPage.drawText(line, {
          x: centeredX,
          y: currentTextY,
          size: fontSize,
          font: customFont,
          color: rgb(0, 0, 0),
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