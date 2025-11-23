const { setGlobalDispatcher, ProxyAgent, fetch } = require("undici");
require('dotenv').config();

// تنظیمات پروکسی شما (طبق عکس NekoBox)
const PROXY_URL = "http://127.0.0.1:2080";

try {
  const dispatcher = new ProxyAgent({
    uri: PROXY_URL,
    connect: { rejectUnauthorized: false }
  });
  setGlobalDispatcher(dispatcher);
  console.log(`🔌 Proxy set to: ${PROXY_URL}`);
} catch (error) {
  console.error("Proxy Error:", error.message);
}

async function getAvailableModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  console.log("⏳ Connecting to Google to list models...");

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      console.error("❌ Google Error:", data.error.message);
      return;
    }

    if (!data.models) {
      console.log("⚠️ No models found!");
      return;
    }

    console.log("\n✅ مدل‌های فعال برای شما:");
    console.log("==================================");
    data.models.forEach(model => {
      // فقط مدل‌های تولید محتوا را نشان بده
      if (model.supportedGenerationMethods.includes("generateContent")) {
        console.log(`🔹 Name: ${model.name.replace('models/', '')}`);
        console.log(`   Version: ${model.version}`);
      }
    });
    console.log("==================================");
    console.log("یکی از نام‌های بالا (قسمت Name) را در فایل index.js کپی کنید.");

  } catch (error) {
    console.error("❌ Connection Error:", error.message);
  }
}

getAvailableModels();