import express from "express";

const app = express();

const SHEET_ID = process.env.SHEET_ID;

async function loadData() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

  const response = await fetch(url);
  const text = await response.text();

  return text;
}

app.get("/", async (req, res) => {
  try {
    const data = await loadData();

    res.send(`<pre>${data.substring(0, 5000)}</pre>`);
  } catch (e) {
    res.send(e.message);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server started on ${PORT}`);
});
