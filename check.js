import fs from "fs";
import puppeteer from "puppeteer";
import fetch from "node-fetch";

const urls = {
  amazon: "https://www.amazon.ca/dp/B0BS5T9B87",
  walmart: "https://www.walmart.ca/search?q=Hogwarts+Castle+LEGO",
  costco: "https://www.costco.ca/lego-harry-potter-hogwarts-castle.product.4000209137.html",
  lego: "https://www.lego.com/en-ca/product/hogwarts-castle-71043"
};

async function scrape(url, selectorList) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-http2",                 // ⭐ 关键：禁用 HTTP/2
      "--disable-features=NetworkService",  // ⭐ 避免 HTTP/2 fallback
      "--disable-blink-features=AutomationControlled" // 更像真人浏览器
    ]
  });

  const page = await browser.newPage();

  // ⭐ 设置真人浏览器 User-Agent
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );

  // ⭐ Costco.ca 必要：降低被屏蔽风险
  await page.setExtraHTTPHeaders({
    "accept-language": "en-US,en;q=0.9"
  });

  // ⭐ 防止直接超时报错
  await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 60000
  });

  let price = null;

  for (const sel of selectorList) {
    try {
      price = await page.$eval(sel, el =>
        el.innerText.replace(/[^0-9.]/g, "")
      );
      if (price) break;
    } catch {}
  }

  await browser.close();
  return parseFloat(price || 0);
}

async function notifyTelegram(msg) {
  const token = process.env.TELEGRAM_TOKEN;
  const chat_id = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat_id) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text: msg })
  });
}

async function main() {
  let history = {};
  if (fs.existsSync("prices.json")) {
    history = JSON.parse(fs.readFileSync("prices.json"));
  }

  const results = {};
  results.date = new Date().toISOString();

  console.log("Checking prices...");

  results.amazon = await scrape(urls.amazon, [
    "#corePrice_feature_div .a-price-whole",
    ".a-offscreen"
  ]);

  results.walmart = await scrape(urls.walmart, [
    ".price",
    ".css-0"
  ]);

  results.costco = await scrape(urls.costco, [
    ".product-price",
    ".value"
  ]);

  results.lego = await scrape(urls.lego, [
    "[data-test='product-price']",
    ".ProductOverviewstyles__ProductPrice"
  ]);

  console.log(results);

  // Check price drop
  const messages = [];
  for (const k of ["amazon", "walmart", "costco", "lego"]) {
    const oldPrice = history[k] || Infinity;
    const newPrice = results[k];

    if (newPrice > 0 && newPrice < oldPrice) {
      messages.push(`📉 ${k.toUpperCase()} price dropped: ${oldPrice} → ${newPrice}`);
    }
  }

  if (messages.length > 0) {
    await notifyTelegram(messages.join("\n"));
  }

  fs.writeFileSync("prices.json", JSON.stringify(results, null, 2));
}

main();
