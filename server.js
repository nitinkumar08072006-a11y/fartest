const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files directly
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, 'mandi_database.json');

// Initialize database file if it does not exist
if (!fs.existsSync(DB_FILE)) {
  const initialData = {
    bookings: [
      { id: 1, centerId: 'C1', date: '2026-08-24', session: 'Morning', token: 1, farmerId: 'KISAN-1001', farmerName: 'Sukhwinder Singh', phone: '9812300001', crop: 'Wheat (Kanak)', weight: 40 },
      { id: 2, centerId: 'C1', date: '2026-08-24', session: 'Morning', token: 2, farmerId: 'KISAN-1002', farmerName: 'Gurdeep Lal', phone: '9812300002', crop: 'Paddy (Dhan)', weight: 25 }
    ],
    capacities: {},
    servingTokens: {}
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
}

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (err) {
    return { bookings: [], capacities: {}, servingTokens: {} };
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// 1. Fetch entire persistent state
app.get('/api/state', (req, res) => {
  res.json(readDb());
});

// 2. Book slot
app.post('/api/book-slot', (req, res) => {
  const { centerId, date, session, farmerId, farmerName, phone, crop, weight } = req.body;
  const db = readDb();
  
  const key = `${centerId}-${date}-${session}`;
  const maxCapacity = db.capacities[key] !== undefined ? db.capacities[key] : 5;
  const currentSessionBookings = db.bookings.filter(b => b.centerId === centerId && b.date === date && b.session === session);

  if (currentSessionBookings.length >= maxCapacity) {
    return res.status(400).json({ error: 'This session is fully booked!' });
  }

  const nextToken = currentSessionBookings.length + 1;
  const newBooking = {
    id: Date.now(),
    centerId,
    date,
    session,
    token: nextToken,
    farmerId,
    farmerName,
    phone,
    crop,
    weight: Number(weight)
  };

  db.bookings.push(newBooking);
  writeDb(db);

  res.status(201).json({ message: 'Slot booked successfully', booking: newBooking });
});

// 3. Update session limit (Admin)
app.post('/api/admin/capacity', (req, res) => {
  const { centerId, date, session, capacity } = req.body;
  const db = readDb();
  const key = `${centerId}-${date}-${session}`;
  
  db.capacities[key] = Number(capacity);
  writeDb(db);

  res.json({ message: 'Capacity updated', key, capacity });
});

// 4. Update counter number (Admin)
app.post('/api/admin/serving-token', (req, res) => {
  const { centerId, date, session, action } = req.body;
  const db = readDb();
  const key = `${centerId}-${date}-${session}`;
  let current = db.servingTokens[key] || 1;

  if (action === 'increment') current++;
  if (action === 'decrement' && current > 1) current--;

  db.servingTokens[key] = current;
  writeDb(db);

  res.json({ message: 'Token counter updated', servingToken: current });
});

// 5. Reset demo data
app.post('/api/reset', (req, res) => {
  const defaultData = {
    bookings: [
      { id: 1, centerId: 'C1', date: '2026-08-24', session: 'Morning', token: 1, farmerId: 'KISAN-1001', farmerName: 'Sukhwinder Singh', phone: '9812300001', crop: 'Wheat (Kanak)', weight: 40 }
    ],
    capacities: {},
    servingTokens: {}
  };
  writeDb(defaultData);
  res.json({ success: true });
});

const PORT = 5000;
// Binding to 0.0.0.0 enables access from any device on your local network
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n==========================================`);
  console.log(`🚀 KisanSetu Backend & Frontend Live:`);
  console.log(`👉 Local: http://localhost:${PORT}`);
  console.log(`==========================================\n`);
});