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

// تابع شکستن متن
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
  console.log(`🔄 Mode: ${translationMode}`);

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

    const baseInstruction = `
    Analyze this PDF page by page. Identify ALL speech bubbles.
    Return a JSON array:
    1. "page_number": Integer.
    2. "text": Persian translation.
    3. "box_2d": [ymin, xmin, ymax, xmax] (0-1000) -> This MUST cover the ORIGINAL text perfectly.
    `;

    let specificRules = translationMode === 'formal' 
      ? `🔥 MODE: FLUENT (روان و دقیق). Use natural spoken grammar ("میرم" not "می‌روم"). No bookish words.` 
      : `🔥 MODE: COOL (باحال). Use slang, capture emotions like anime fansubs.`;

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

      // 1. استفاده از ابعاد دقیق باکس اصلی (انگلیسی)
      // جمنای مختصات متن اصلی را می‌دهد، ما دقیقاً همانجا را سفید می‌کنیم
      const boxX = (xmin / 1000) * width;
      const boxY = height - ((ymax / 1000) * height);
      const boxWidth = ((xmax - xmin) / 1000) * width;
      const boxHeight = ((ymax - ymin) / 1000) * height;

      // کشیدن مستطیل سفید دقیقاً روی متن اصلی
      // کمی پدینگ اضافه می‌کنیم تا مطمئن شویم لبه‌های متن انگلیسی بیرون نمی‌زند
      const cleanPadding = 3; 
      currentPage.drawRectangle({
        x: boxX - cleanPadding,
        y: boxY - cleanPadding,
        width: boxWidth + (cleanPadding * 2),
        height: boxHeight + (cleanPadding * 2),
        color: rgb(1, 1, 1),
        borderWidth: 0,
        opacity: 1.0, 
      });

      // 2. فیت کردن متن فارسی داخل این باکس (Auto-fit)
      // متن فارسی باید داخل همین باکسی که سفید کردیم جا بشود
      let fontSize = 12;
      let textLines = [];
      let textHeight = 0;

      // الگوریتم کوچک کردن فونت تا زمانی که متن جا شود
      while (fontSize > 6) {
        textLines = wrapText(item.text, customFont, fontSize, boxWidth);
        textHeight = textLines.length * (fontSize * 1.2);
        
        if (textHeight <= boxHeight + 10) { // +10 ارفاق برای بیرون زدگی جزئی
            break; 
        }
        fontSize -= 1; // فونت را کوچک کن و دوباره تست کن
      }

      // 3. نوشتن متن (وسط‌چین)
      let currentTextY = boxY + (boxHeight / 2) + (textHeight / 2) - fontSize;

      for (const line of textLines) {
        const lineWidth = customFont.widthOfTextAtSize(line, fontSize);
        const centeredX = boxX + (boxWidth - lineWidth) / 2;
        
        currentPage.drawText(line, {
          x: centeredX,
          y: currentTextY,
          size: fontSize,
          font: customFont,
          color: rgb(0, 0, 0),
        });
        currentTextY -= (fontSize * 1.2);
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