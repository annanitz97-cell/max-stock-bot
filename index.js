import express from "express";
import { parse } from "csv-parse/sync";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SHEET_ID = process.env.SHEET_ID;
const MAX_TOKEN = process.env.MAX_TOKEN;
const MAX_WEBHOOK_SECRET = process.env.MAX_WEBHOOK_SECRET;

const WAREHOUSES = [
  { name: "Оренбург", index: 8 },
  { name: "Зал", index: 9 },
  { name: "Москва", index: 10 },
  { name: "Магазин", index: 11 },
  { name: "Екатеринбург", index: 12 },
  { name: "Баумана", index: 14 },
  { name: "Озон Екат", index: 15 }
];

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[«»"']/g, "")
    .trim();
}

function compact(value) {
  return normalize(value).replace(/[\s_\-.,/\\]+/g, "");
}

function toNumber(value) {
  const n = Number(String(value || "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
}

async function loadRows() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Не удалось загрузить таблицу. Код: ${response.status}`);
  }

  const csv = await response.text();

  return parse(csv, {
    skip_empty_lines: false,
    relax_quotes: true,
    relax_column_count: true,
    trim: true
  });
}

function getProducts(rows) {
  return rows
    .slice(2)
    .map((row) => {
      const modelArticle = row[1] || "";
      const barcode = row[2] || "";
      const article = row[3] || "";
      const name = row[4] || "";
      const characteristic = row[5] || "";

      const stocks = WAREHOUSES.map((warehouse) => ({
        name: warehouse.name,
        amount: toNumber(row[warehouse.index])
      }));

      const total = stocks.reduce((sum, item) => sum + item.amount, 0);

      return {
        modelArticle,
        barcode,
        article,
        name,
        characteristic,
        stocks,
        total,
        raw: row
      };
    })
   .filter((product) => {
  return product.name;
});
}

function findProducts(products, query) {
  const q = normalize(query);
  const qc = compact(query);

  return products.filter((product) => {
    const text = [
      product.modelArticle,
      product.barcode,
      product.article,
      product.name,
      product.characteristic
    ].join(" ");

    return normalize(text).includes(q) || compact(text).includes(qc);
  });
}

function formatProduct(product, index = null) {
  const titleNumber = index !== null ? `${index + 1}. ` : "";

  const visibleStocks = product.stocks.filter((item) => item.amount > 0);

  const stockText = visibleStocks.length
    ? visibleStocks.map((item) => `${item.name}: ${item.amount}`).join("\n")
    : "Остатков по складам не указано";

  return `${titleNumber}${product.name}
Артикул: ${product.article || "—"}
Мод. артикул: ${product.modelArticle || "—"}

${stockText}

Итого: ${product.total}`;
}

function formatSearchAnswer(products, query) {
  if (!products.length) {
    return `По запросу "${query}" ничего не нашла 😬

Попробуйте написать артикул, мод. артикул или часть названия.`;
  }

  const limited = products.slice(0, 7);

  const text = limited
    .map((product, index) => formatProduct(product, products.length > 1 ? index : null))
    .join("\n\n——————\n\n");

  const extra = products.length > 7
    ? `\n\nПоказала первые 7 позиций из ${products.length}. Уточните запрос.`
    : "";

  return `${text}${extra}`;
}

async function sendMaxMessage({ userId, chatId, text }) {
  const params = userId ? `user_id=${userId}` : `chat_id=${chatId}`;

  await fetch(`https://platform-api.max.ru/messages?${params}`, {
    method: "POST",
    headers: {
      Authorization: MAX_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });
}

app.get("/", (req, res) => {
  res.send("MAX stock bot is running");
});

app.get("/search", async (req, res) => {
  try {
    const query = req.query.q || "";

    if (!query) {
      return res.send("Добавь запрос так: /search?q=vst016");
    }

    const rows = await loadRows();
    const products = getProducts(rows);
    const found = findProducts(products, query);

    res.type("text/plain").send(formatSearchAnswer(found, query));
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const secret = req.headers["x-max-bot-api-secret"];

    if (MAX_WEBHOOK_SECRET && secret !== MAX_WEBHOOK_SECRET) {
      return res.status(401).send("Invalid secret");
    }

    res.sendStatus(200);

    const update = req.body;

    const message =
      update?.message ||
      update?.message_created?.message ||
      update?.update?.message;

    const text = message?.body?.text || message?.text || "";
    const userId = message?.sender?.user_id || message?.recipient?.user_id;
    const chatId = message?.chat_id || message?.recipient?.chat_id;

    if (!text || (!userId && !chatId)) return;

    if (text === "/start") {
      await sendMaxMessage({
        userId,
        chatId,
        text: "Привет! Напишите артикул, мод. артикул или часть названия продукции — я покажу актуальные остатки."
      });
      return;
    }

    const rows = await loadRows();
    const products = getProducts(rows);
    const found = findProducts(products, text);
    const answer = formatSearchAnswer(found, text);

    await sendMaxMessage({ userId, chatId, text: answer });
  } catch (error) {
    console.error(error);
  }
});

app.listen(PORT, () => {
  console.log(`Server started on ${PORT}`);
});
