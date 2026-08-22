const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const XLSX = require('xlsx');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'ux')));

const DB_FILE = path.join(__dirname, 'db.json');
const ADMIN_PASSWORD = "admin@kisan2026";

const PAYMENT_STAGES = [
    "Verification from District Nodal Officer",
    "Verification from Ministry",
    "Ministry to PFMS Transfer",
    "Money Transferred"
];

// Initialize persistent DB if not present
function loadDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            const initialData = {
                farmers: [],
                bookings: [],
                feedbacks: [],
                prices: {
                    "Wheat": 25,
                    "Rice": 32,
                    "Cotton": 65,
                    "Mustard": 55,
                    "Soybean": 48
                },
                centerCapacity: {
                    "District Mandi Center A": 20,
                    "District Mandi Center B": 15,
                    "District Mandi Center C": 25
                },
                activeTokens: {}
            };
            fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
            return initialData;
        }
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } catch (e) {
        return { farmers: [], bookings: [], feedbacks: [], prices: {}, centerCapacity: {}, activeTokens: {} };
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function generateRegNo() {
    return 'REG-' + Math.floor(100000 + Math.random() * 900000);
}

// Serve root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'), (err) => {
        if (err) res.sendFile(path.join(__dirname, 'ux', 'index.html'));
    });
});

// Fetch current MSP prices
app.get('/api/prices', (req, res) => {
    const db = loadDB();
    res.json(db.prices);
});

// 1. Farmer Registration
app.post('/api/register', (req, res) => {
    try {
        const { name, mobile, aadhar, password } = req.body;
        if (!name || !mobile || !password) {
            return res.status(400).json({ success: false, error: 'Name, Mobile, and Password are required.' });
        }

        const db = loadDB();
        const existing = db.farmers.find(f => f.mobile === mobile.trim());
        if (existing) {
            return res.status(400).json({ success: false, error: `Mobile already registered with ID: ${existing.regNo}` });
        }

        const regNo = generateRegNo();
        const newFarmer = {
            regNo,
            password,
            name,
            mobile: mobile.trim(),
            aadhar: aadhar ? aadhar.trim() : '',
            createdAt: new Date().toISOString()
        };

        db.farmers.push(newFarmer);
        saveDB(db);
        res.json({ success: true, regNo, message: 'Registration complete' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Registration error' });
    }
});

// 2. Farmer Login
app.post('/api/login', (req, res) => {
    try {
        const { regNo, password } = req.body;
        const db = loadDB();
        const farmer = db.farmers.find(f => f.regNo.trim().toUpperCase() === (regNo || '').trim().toUpperCase() && f.password === password);

        if (!farmer) {
            return res.status(401).json({ success: false, error: 'Invalid Registration Number or Password' });
        }

        const farmerBookings = db.bookings.filter(b => b.regNo === farmer.regNo);
        res.json({ success: true, farmer, bookings: farmerBookings });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Login error' });
    }
});

// 3. Slot Availability Check
app.get('/api/slots/availability', (req, res) => {
    const { center, date, session } = req.query;
    const db = loadDB();
    const maxCap = db.centerCapacity[center] || 20;
    const bookedCount = db.bookings.filter(b => b.center === center && b.slotDate === date && b.session === session).length;
    const available = Math.max(0, maxCap - bookedCount);

    const tokenKey = `${center}_${date}_${session}`;
    const currentServedToken = db.activeTokens[tokenKey] || 0;

    res.json({
        center,
        date,
        session,
        maxCapacity: maxCap,
        booked: bookedCount,
        availableSlots: available,
        currentServedToken
    });
});

// 4. Book Slot (Restricted to 1 Active Token per farmer)
app.post('/api/slots/book', (req, res) => {
    try {
        const { regNo, crop, quantityKg, center, slotDate, session } = req.body;
        const db = loadDB();
        const farmer = db.farmers.find(f => f.regNo === regNo);
        if (!farmer) return res.status(404).json({ success: false, error: 'Farmer profile not found' });

        // Check if farmer already has an active pending token (steps 0, 1, or 2)
        const hasActiveBooking = db.bookings.some(b => b.regNo === regNo && b.paymentStep < 3);
        if (hasActiveBooking) {
            return res.status(400).json({
                success: false,
                error: 'You already have an active Mandi Token in progress! You cannot generate another until your current payout is completed.'
            });
        }

        const maxCap = db.centerCapacity[center] || 20;
        const sessionBookings = db.bookings.filter(b => b.center === center && b.slotDate === slotDate && b.session === session);

        if (sessionBookings.length >= maxCap) {
            return res.status(400).json({ success: false, error: 'Session is full. Choose another session or date.' });
        }

        const tokenSeq = sessionBookings.length + 1;
        const tokenNumber = `TKN-${String(tokenSeq).padStart(3, '0')}`;
        const ratePerKg = db.prices[crop] || 25;
        const totalAmount = ratePerKg * Number(quantityKg || 1);

        const newBooking = {
            bookingId: 'BK-' + Date.now().toString().slice(-6),
            regNo: farmer.regNo,
            farmerName: farmer.name,
            mobile: farmer.mobile,
            crop,
            quantityKg: Number(quantityKg),
            ratePerKg,
            totalAmount,
            center,
            slotDate,
            session,
            tokenNumber,
            tokenSeq,
            paymentStep: 0,
            status: PAYMENT_STAGES[0],
            bookedAt: new Date().toISOString()
        };

        db.bookings.push(newBooking);
        saveDB(db);
        res.json({ success: true, booking: newBooking });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to book slot' });
    }
});

// 5. Admin Authentication
app.post('/api/admin/login', (req, res) => {
    const { adminPassword } = req.body;
    if (adminPassword === ADMIN_PASSWORD) {
        return res.json({ success: true });
    }
    return res.status(401).json({ success: false, error: 'Incorrect Officer Password' });
});

// 6. Admin Records
app.get('/api/admin/records', (req, res) => {
    const { date, crop, center } = req.query;
    const db = loadDB();
    let filtered = [...db.bookings];

    if (date) filtered = filtered.filter(b => b.slotDate === date);
    if (crop) filtered = filtered.filter(b => b.crop.toLowerCase().includes(crop.toLowerCase()));
    if (center) filtered = filtered.filter(b => b.center.toLowerCase().includes(center.toLowerCase()));

    res.json(filtered);
});

// 7. Admin Update Payment Step
app.post('/api/admin/update-payment', (req, res) => {
    const { bookingId, stepIndex } = req.body;
    const db = loadDB();
    const booking = db.bookings.find(b => b.bookingId === bookingId);
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    const idx = Number(stepIndex);
    booking.paymentStep = idx;
    booking.status = PAYMENT_STAGES[idx];

    saveDB(db);
    res.json({ success: true, booking });
});

// 8. Admin Update MSP Price
app.post('/api/admin/update-price', (req, res) => {
    const { crop, price } = req.body;
    const db = loadDB();
    if (crop && price) {
        db.prices[crop] = Number(price);
        saveDB(db);
        return res.json({ success: true, prices: db.prices });
    }
    res.status(400).json({ success: false, error: 'Invalid crop or price input' });
});

// 9. Admin Update Capacity
app.post('/api/admin/update-capacity', (req, res) => {
    const { center, capacity } = req.body;
    const db = loadDB();
    if (center && capacity) {
        db.centerCapacity[center] = Number(capacity);
        saveDB(db);
        return res.json({ success: true, centerCapacity: db.centerCapacity });
    }
    res.status(400).json({ success: false, error: 'Invalid capacity' });
});

// 10. Admin Update Served Token
app.post('/api/admin/update-token-progress', (req, res) => {
    const { center, date, session, currentTokenSeq } = req.body;
    const db = loadDB();
    const key = `${center}_${date}_${session}`;
    db.activeTokens[key] = Number(currentTokenSeq);
    saveDB(db);
    res.json({ success: true, currentServedToken: db.activeTokens[key] });
});

// 11. Admin Export to Excel
app.get('/api/admin/export-excel', (req, res) => {
    try {
        const db = loadDB();
        const exportData = db.bookings.map(item => ({
            "Booking ID": item.bookingId,
            "Token No": item.tokenNumber,
            "Reg No": item.regNo,
            "Farmer Name": item.farmerName,
            "Mobile": item.mobile,
            "Crop": item.crop,
            "Quantity (Kg)": item.quantityKg,
            "Rate / Kg (INR)": item.ratePerKg,
            "Total Payout (INR)": item.totalAmount,
            "Procurement Center": item.center,
            "Slot Date": item.slotDate,
            "Session": item.session,
            "Payment Status": item.status
        }));

        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Procurement_Slots");

        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', 'attachment; filename="Kisan_Procurement_Master.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        res.status(500).send('Error generating Excel');
    }
});

// 12. Feedback
app.post('/api/feedback', (req, res) => {
    const { name, mobile, message } = req.body;
    const db = loadDB();
    db.feedbacks.push({ name, mobile, message, date: new Date().toISOString() });
    saveDB(db);
    res.json({ success: true, message: 'Feedback submitted successfully' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
