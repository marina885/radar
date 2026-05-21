import express from 'express';
import fs from 'fs/promises';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY || '';
const API_HOST = process.env.API_FOOTBALL_HOST || 'api-football-v1.p.rapidapi.com';
const ROOT = process.cwd();
const DAILY_DIR = path.join(ROOT, 'data', 'daily');
const WEEKLY_DIR = path.join(ROOT, 'data', 'weekly');

app.use(express.json());
app.use(express.static('public'));

async function ensureDirs() {
  await fs.mkdir(DAILY_DIR, { recursive: true });
  await fs.mkdir(WEEKLY_DIR, { recursive: true });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

async function saveJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function normalizeFixture(item) {
  return {
    league: item?.league?.name || '',
    home: item?.teams?.home?.name || '',
    away: item?.teams?.away?.name || '',
    status: item?.fixture?.status?.short || '',
    date: item?.fixture?.date || '',
    goalsHome: item?.goals?.home ?? null,
    goalsAway: item?.goals?.away ?? null
  };
}

function buildCommentary(fixtures) {
  return fixtures.slice(0, 6).map(f => ({
    title: `${f.home} vs ${f.away}`,
    summary: `Partido ${f.status || 'sin estado'} en ${f.league}.`,
    comment: `Este partido deja una lectura útil para contenido: ${f.home} y ${f.away} aportan contexto sobre rendimiento, dinámica de equipo y posibles temas de conversación en redes. Si el resultado fue ajustado, el foco está en detalles tácticos, errores puntuales y momentos clave; si fue amplio, conviene analizar qué cambió en intensidad, estructura o efectividad.`,
    meta: f.date
  }));
}

async function fetchFootballData() {
  if (!API_KEY) return { fixtures: [], source: 'missing_api_key' };

  const url = 'https://api-football-v1.p.rapidapi.com/v3/fixtures?live=all';
  const res = await fetch(url, {
    headers: {
      'x-rapidapi-key': API_KEY,
      'x-rapidapi-host': API_HOST
    }
  });

  const json = await res.json();
  const fixtures = Array.isArray(json?.response) ? json.response.map(normalizeFixture) : [];
  return { fixtures, source: 'api-football' };
}

async function updateDaily() {
  await ensureDirs();

  const date = todayISO();
  const wk = weekKey();
  const payload = await fetchFootballData();

  const body = {
    date,
    week: wk,
    source: payload.source,
    trending: buildCommentary(payload.fixtures),
    fixtures: payload.fixtures,
    updatedAt: new Date().toISOString()
  };

  await saveJson(path.join(DAILY_DIR, `${date}.json`), body);
  await saveJson(path.join(DAILY_DIR, 'latest.json'), body);

  const weekFile = path.join(WEEKLY_DIR, `${wk}.json`);
  const existing = await readJson(weekFile, { week: wk, days: [] });
  const filteredDays = (existing.days || []).filter(d => d.date !== date);

  filteredDays.push({
    date,
    trending: body.trending,
    fixtures: body.fixtures,
    updatedAt: body.updatedAt
  });

  await saveJson(weekFile, {
    week: wk,
    days: filteredDays.sort((a, b) => a.date.localeCompare(b.date))
  });

  return body;
}

app.get('/api/today', async (req, res) => {
  const latest = await readJson(path.join(DAILY_DIR, 'latest.json'));
  if (latest) return res.json(latest);
  res.json(await updateDaily());
});

app.get('/api/week/:week', async (req, res) => {
  const data = await readJson(path.join(WEEKLY_DIR, `${req.params.week}.json`));
  if (!data) return res.status(404).json({ error: 'week_not_found' });
  res.json(data);
});

app.post('/api/update', async (req, res) => {
  try {
    res.json({ ok: true, data: await updateDaily() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

ensureDirs().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on ${PORT}`));
});
