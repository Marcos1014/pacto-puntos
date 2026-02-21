const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const DATA_FILE = '/tmp/pacto-data.json';

const GESTOS = [
  { id: 'foto', name: 'Foto linda sin que la pida', points: 1 },
  { id: 'preparar', name: 'Preparar/servir algo', points: 1 },
  { id: 'mimos', name: 'Mimos', points: 1 },
  { id: 'compu', name: 'Prestar compu', points: 1 },
  { id: 'masajes', name: 'Masajes 10 min', points: 2 },
  { id: 'actividad', name: 'Acompañar a actividad', points: 2 },
  { id: 'pelo', name: 'Lavar/secar pelo', points: 2 },
  { id: 'fiaca', name: 'Fiaca en cama juntos', points: 2 },
  { id: 'regional', name: 'Traer algo regional', points: 2 },
  { id: 'sorpresa', name: 'Sorpresa linda', points: 3 },
  { id: 'premium', name: 'Servicio premium', points: 3 },
];

const CANJES = [
  { id: 'alarma', name: 'Pospuesto extra alarma', cost: 1 },
  { id: 'bano', name: '10 min extra baño', cost: 1 },
  { id: 'fotos', name: 'Sesión fotos sin límite', cost: 2 },
  { id: 'elegir', name: 'Elegir actividad del día', cost: 2 },
  { id: 'tarde', name: 'Tarde libre', cost: 2 },
  { id: 'notebook', name: 'Hora de notebook', cost: 2 },
  { id: 'masajes_largos', name: 'Masajes largos ❤️', cost: 3 },
  { id: 'premium_canje', name: 'Servicio premium 🔥', cost: 3 },
];

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    const initial = {
      users: {
        marcos: { points: 0 },
        sofi: { points: 0 }
      },
      gestos: [],    // { id, user, gestoId, points, timestamp, status: pending|approved|rejected|disputed }
      canjes: [],    // { id, user, canjeId, cost, timestamp, status: pending|approved|rejected }
      counter: 0
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function otherUser(user) {
  return user === 'marcos' ? 'sofi' : 'marcos';
}

// Check if we're in a review window (ART = UTC-3)
function isReviewTime() {
  const now = new Date();
  const artHour = (now.getUTCHours() - 3 + 24) % 24;
  const artMin = now.getUTCMinutes();
  // Windows: 10:00-10:30, 16:00-16:30, 22:00-22:30 ART
  const windows = [10, 16, 22];
  return windows.some(h => artHour === h && artMin < 30);
}

function todayART() {
  const now = new Date();
  const art = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return art.toISOString().slice(0, 10);
}

// API Routes
app.get('/api/config', (req, res) => {
  res.json({ gestos: GESTOS, canjes: CANJES });
});

app.get('/api/status', (req, res) => {
  const { user } = req.query;
  if (!user || !['marcos', 'sofi'].includes(user)) return res.status(400).json({ error: 'Invalid user' });
  
  const data = loadData();
  const other = otherUser(user);
  const review = isReviewTime();
  
  // Calculate approved points
  const myApproved = data.gestos.filter(g => g.user === user && g.status === 'approved')
    .reduce((s, g) => s + g.points, 0);
  const otherApproved = data.gestos.filter(g => g.user === other && g.status === 'approved')
    .reduce((s, g) => s + g.points, 0);
  
  // Spent points on canjes
  const mySpent = data.canjes.filter(c => c.user === user && c.status === 'approved')
    .reduce((s, c) => s + c.cost, 0);
  const otherSpent = data.canjes.filter(c => c.user === other && c.status === 'approved')
    .reduce((s, c) => s + c.cost, 0);
  
  // My pending gestos
  const myPending = data.gestos.filter(g => g.user === user && g.status === 'pending');
  
  // Other's pending gestos (only visible during review)
  const toReview = review ? data.gestos.filter(g => g.user === other && g.status === 'pending') : [];
  
  // Canjes
  const myCanjes = data.canjes.filter(c => c.user === user);
  const pendingCanjes = data.canjes.filter(c => c.user === other && c.status === 'pending');
  
  // Canjes today count
  const today = todayART();
  const canjesToday = data.canjes.filter(c => c.user === user && c.timestamp.startsWith(today)).length;
  
  // Disputed items
  const disputed = data.gestos.filter(g => g.status === 'disputed');
  
  // History (approved/rejected)
  const history = data.gestos.filter(g => g.status !== 'pending').slice(-50);
  
  res.json({
    user,
    review,
    myPoints: myApproved - mySpent,
    otherPoints: otherApproved - otherSpent,
    myTotalEarned: myApproved,
    myTotalSpent: mySpent,
    myPending,
    toReview,
    myCanjes,
    pendingCanjes,
    canjesToday,
    disputed,
    history
  });
});

app.post('/api/gesto', (req, res) => {
  const { user, gestoId } = req.body;
  if (!user || !['marcos', 'sofi'].includes(user)) return res.status(400).json({ error: 'Invalid user' });
  
  const gesto = GESTOS.find(g => g.id === gestoId);
  if (!gesto) return res.status(400).json({ error: 'Invalid gesto' });
  
  const data = loadData();
  data.counter++;
  data.gestos.push({
    id: data.counter,
    user,
    gestoId: gesto.id,
    gestoName: gesto.name,
    points: gesto.points,
    timestamp: new Date().toISOString(),
    status: 'pending'
  });
  saveData(data);
  res.json({ ok: true });
});

app.post('/api/review', (req, res) => {
  const { user, gestoDbId, action } = req.body;
  if (!user || !['marcos', 'sofi'].includes(user)) return res.status(400).json({ error: 'Invalid user' });
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  
  const data = loadData();
  const gesto = data.gestos.find(g => g.id === gestoDbId && g.user === otherUser(user) && g.status === 'pending');
  if (!gesto) return res.status(404).json({ error: 'Gesto not found' });
  
  if (action === 'approve') {
    gesto.status = 'approved';
  } else {
    gesto.status = 'disputed'; // Goes to Sirius mediation
  }
  saveData(data);
  res.json({ ok: true, status: gesto.status });
});

app.post('/api/canje', (req, res) => {
  const { user, canjeId } = req.body;
  if (!user || !['marcos', 'sofi'].includes(user)) return res.status(400).json({ error: 'Invalid user' });
  
  const canje = CANJES.find(c => c.id === canjeId);
  if (!canje) return res.status(400).json({ error: 'Invalid canje' });
  
  const data = loadData();
  
  // Check max 3 canjes today
  const today = todayART();
  const canjesToday = data.canjes.filter(c => c.user === user && c.timestamp.startsWith(today)).length;
  if (canjesToday >= 3) return res.status(400).json({ error: 'Máximo 3 canjes por día' });
  
  // Check points
  const approved = data.gestos.filter(g => g.user === user && g.status === 'approved').reduce((s, g) => s + g.points, 0);
  const spent = data.canjes.filter(c => c.user === user && c.status === 'approved').reduce((s, c) => s + c.cost, 0);
  const available = approved - spent;
  if (available < canje.cost) return res.status(400).json({ error: 'Puntos insuficientes' });
  
  data.counter++;
  data.canjes.push({
    id: data.counter,
    user,
    canjeId: canje.id,
    canjeName: canje.name,
    cost: canje.cost,
    timestamp: new Date().toISOString(),
    status: 'pending'
  });
  saveData(data);
  res.json({ ok: true });
});

app.post('/api/canje-review', (req, res) => {
  const { user, canjeDbId, action } = req.body;
  if (!user || !['marcos', 'sofi'].includes(user)) return res.status(400).json({ error: 'Invalid user' });
  
  const data = loadData();
  const canje = data.canjes.find(c => c.id === canjeDbId && c.user === otherUser(user) && c.status === 'pending');
  if (!canje) return res.status(404).json({ error: 'Canje not found' });
  
  canje.status = action === 'approve' ? 'approved' : 'rejected';
  saveData(data);
  res.json({ ok: true });
});

app.listen(3000, () => console.log('Pacto Puntos running on :3000'));
