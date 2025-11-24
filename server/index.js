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
    3. "box_2d": [ymin, xmin, ymax, xmax] (0-1000).
    `;

    let specificRules = '';

    if (translationMode === 'formal') {
        // 📜 حالت ۱: پایبند به متن (اما محاوره‌ای و روان)
        specificRules = `
        🔥 MODE: FAITHFUL & SPOKEN (پایبند به متن ولی محاوره‌ای)
        
        **GOAL:** Translate the EXACT meaning without adding/removing info, BUT use **Natural Spoken Persian** grammar.
        
        **⛔ STRICT FORBIDDEN WORDS (NEVER USE):**
        - ❌ "است" -> ✅ Use "ـه" (e.g., "خوب است" -> "خوبه", "عقل سلیم است" -> "عقل سلیمه").
        - ❌ "بسیار" -> ✅ Use "خیلی".
        - ❌ "آیا" -> ✅ Drop it (Just ask the question).
        - ❌ "اکنون" -> ✅ Use "الان".
        - ❌ "زیرا" -> ✅ Use "چون".
        - ❌ "می‌روم/می‌شود" -> ✅ Use "میرم/میشه".

        **✅ RULES:**
        - Keep the translation FAITHFUL to the original English text. Do not add jokes that aren't there.
        - Just make the sentences sound like a normal Iranian person speaking, NOT a book.
        `;
    } else {
        // 😎 حالت ۲: باحال و آزاد (آزاد)
        specificRules = `
        🔥 MODE: LOCALIZED & COOL (باحال و آزاد)
        - **Goal:** Make it sound like a cool Anime Dub / Fan-sub.
        - **Style:** You can change the wording significantly to match the *vibe* and *emotion*.
        - **Slang:** Use street slang ("دمت گرم", "ایول", "ضایع شد") freely if it fits.
        - **Focus:** Impact is more important than exact word-for-word accuracy.
        `;
    }

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

      let fontSize = 10;
      if (item.text.length > 60) fontSize = 9;
      if (item.text.length > 100) fontSize = 8;

      const coverPadding = 4; 

      currentPage.drawRectangle({
        x: originalBoxX - coverPadding,
        y: originalBoxY - coverPadding,
        width: originalBoxWidth + (coverPadding * 2),
        height: originalBoxHeight + (coverPadding * 2),
        color: rgb(1, 1, 1),
        borderWidth: 0,
        opacity: 1.0, 
      });

      const effectiveWidth = Math.max(originalBoxWidth - 4, 40); 
      let textLines = wrapText(item.text, customFont, fontSize, effectiveWidth);
      const totalTextHeight = textLines.length * (fontSize * 1.3); 
      let currentTextY = originalBoxY + (originalBoxHeight / 2) + (totalTextHeight / 2) - fontSize;

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