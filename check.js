import fs from "fs";
import puppeteer from "puppeteer";
import fetch from "node-fetch";

const urls = {
  amazon: "https://www.amazon.ca/dp/B0BS5T9B87",
  walmart: "https://www.walmart.ca/search?q=Hogwarts+Castle+LEGO",
  lego: "https://www.lego.com/en-ca/product/hogwarts-castle-71043",
  bestbuy: "https://www.bestbuy.ca/en-ca/search?search=Hogwarts+castle+LEGO",
  google: "https://www.google.com/search?q=LEGO+Hogwarts+Castle+76454+price+Canada"
};

// ---- Generic Puppeteer scraper ----
async function scrape(url, selectorList) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-http2"
    ]
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });

  let price = null;

  for (const sel of selectorList) {
    try {
      price = await page.$eval(sel, el => el.innerText.replace(/[^0-9.]/g, ""));
      if (price) break;
    } catch {}
  }

  await browser.close();
  return parseFloat(price || 0);
}

// ---- Google Search special scraper ----
async function scrapeGoogle(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });

  let price = 0;

  try {
    // Google 通常会显示：$469 · In stock
    const txt = await page.$eval("body", el => el.innerText);
    const match = txt.match(/\$\d+\.?\d*/);
    if (match) price = parseFloat(match[0].replace("$", ""));
  } catch {}

  await browser.close();
  return price;
}

// ---- Telegram ----
async function notifyTelegram(msg) {
  const token = process.env.TELEGRAM_TOKEN;
  const chat_id = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat_id) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ chat_id, text: msg })
  });
}

// ---- Main ----
async function main() {
  let history = {};
  if (fs.existsSync("prices.json")) {
    history = JSON.parse(fs.readFileSync("prices.json"));
  }

  const results = {};
  results.date = new Date().toISOString();

  console.log("Checking prices...");

  results.amazon = await scrape(urls.amazon, [
    ".a-price .a-offscreen",
    "#corePrice_feature_div .a-price-whole"
  ]);

  results.walmart = await scrape(urls.walmart, [
    ".price",
    ".css-0"
  ]);

  results.lego = await scrape(urls.lego, [
    "[data-test='product-price']",
    ".ProductOverviewstyles__ProductPrice"
  ]);

  // ⭐ NEW: BestBuy
  results.bestbuy = await scrape(urls.bestbuy, [
    ".productListing .productItemPrice",
    ".pricing-price__regular-price"
  ]);

  // ⭐ NEW: Google Search
  results.google = await scrapeGoogle(urls.google);

  console.log(results);

  // ---- price drop alerts ----
  const messages = [];
  for (const k of ["amazon", "walmart", "lego", "bestbuy", "google"]) {
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
