import fs from "fs";
import puppeteer from "puppeteer";
import fetch from "node-fetch";

const urls = {
  amazon: "https://www.amazon.ca/dp/B0BS5T9B87",
  walmart: "https://www.walmart.ca/search?q=Hogwarts+Castle+LEGO",
  lego: "https://www.lego.com/en-ca/product/hogwarts-castle-71043",
  bestbuy: "https://www.bestbuy.ca/en-ca/search?search=Hogwarts+Castle+LEGO",
  google: "https://www.google.com/search?q=LEGO+76454+Hogwarts+Castle+price"
};

async function scrape(url, selectorList) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  } catch {
    console.log(`⚠️ Timeout loading ${url}`);
  }

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

  results.amazon = await scrape(urls.amazon, ["#corePrice_feature_div .a-price-whole", ".a-offscreen"]);
  results.walmart = await scrape(urls.walmart, [".price", ".css-0"]);
  results.lego = await scrape(urls.lego, ["[data-test='product-price']", ".ProductOverviewstyles__ProductPrice"]);
  results.bestbuy = await scrape(urls.bestbuy, [".priceView-customer-price span", ".pricing-price__wrapper"]);
  results.google = await scrape(urls.google, [".a-price-whole", ".a-offscreen"]);

  console.log(results);

  // 只发送价格下降消息
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
  } else {
    console.log("No price drop detected.");
  }

  fs.writeFileSync("prices.json", JSON.stringify(results, null, 2));
}

main();
