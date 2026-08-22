const express = require('express');
const path = require('path');
const cors = require('cors');
const XLSX = require('xlsx');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets from both root directory and /ux folder if present
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'ux')));

// Master Backend Officer Password
const ADMIN_PASSWORD = "admin@kisan2026";

// Government MSP Price configuration per kg
const PRICE_CONFIG = {
    "Wheat": 25,
    "Rice": 32,
    "Cotton": 65,
    "Mustard": 55,
    "Soybean": 48
};

// 4-stage payment verification pipeline
const PAYMENT_STAGES = [
    "Verification from District Nodal Officer",
    "Verification from Ministry",
    "Ministry to PFMS Transfer",
    "Money Transferred"
];

let farmers = [];
let bookings = [];
let feedbacks = [];

let centerCapacity = {
    "District Mandi Center A": 20,
    "District Mandi Center B": 15,
    "District Mandi Center C": 25
};

let activeTokens = {};

function generateRegNo() {
    return 'REG-' + Math.floor(100000 + Math.random() * 900000);
}

// Serve index.html on root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'), (err) => {
        if (err) res.sendFile(path.join(__dirname, 'ux', 'index.html'));
    });
});

// 1. Farmer Registration
app.post('/api/register', (req, res) => {
    try {
        const { name, mobile, aadhar, password } = req.body;
        if (!name || !mobile || !password) {
            return res.status(400).json({ success: false, error: 'Name, Mobile, and Password are required.' });
        }

        const regNo = generateRegNo();
        const newFarmer = {
            regNo,
            password,
            name,
            mobile,
            aadhar: aadhar || '',
            createdAt: new Date()
        };

        farmers.push(newFarmer);
        res.json({ success: true, regNo, message: 'Registration complete' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Registration error' });
    }
});

// 2. Farmer Login
app.post('/api/login', (req, res) => {
    try {
        const { regNo, password } = req.body;
        const farmer = farmers.find(f => f.regNo.trim().toUpperCase() === (regNo || '').trim().toUpperCase() && f.password === password);

        if (!farmer) {
            return res.status(401).json({ success: false, error: 'Invalid Registration Number or Password' });
        }

        const farmerBookings = bookings.filter(b => b.regNo === farmer.regNo);
        res.json({ success: true, farmer, bookings: farmerBookings });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Login error' });
    }
});

// 3. Slot Availability Check
app.get('/api/slots/availability', (req, res) => {
    const { center, date, session } = req.query;
    const maxCap = centerCapacity[center] || 20;
    const bookedCount = bookings.filter(b => b.center === center && b.slotDate === date && b.session === session).length;
    const available = Math.max(0, maxCap - bookedCount);

    const tokenKey = `${center}_${date}_${session}`;
    const currentServedToken = activeTokens[tokenKey] || 0;

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

// 4. Book Slot & Generate Token
app.post('/api/slots/book', (req, res) => {
    try {
        const { regNo, crop, quantityKg, center, slotDate, session } = req.body;
        const farmer = farmers.find(f => f.regNo === regNo);
        if (!farmer) return res.status(404).json({ success: false, error: 'Farmer profile not found' });

        const maxCap = centerCapacity[center] || 20;
        const sessionBookings = bookings.filter(b => b.center === center && b.slotDate === slotDate && b.session === session);

        if (sessionBookings.length >= maxCap) {
            return res.status(400).json({ success: false, error: 'Session is full. Choose another session or date.' });
        }

        const tokenSeq = sessionBookings.length + 1;
        const tokenNumber = `TKN-${String(tokenSeq).padStart(3, '0')}`;
        const ratePerKg = PRICE_CONFIG[crop] || 20;
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

        bookings.push(newBooking);
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
    let filtered = [...bookings];

    if (date) filtered = filtered.filter(b => b.slotDate === date);
    if (crop) filtered = filtered.filter(b => b.crop.toLowerCase().includes(crop.toLowerCase()));
    if (center) filtered = filtered.filter(b => b.center.toLowerCase().includes(center.toLowerCase()));

    res.json(filtered);
});

// 7. Admin Update Payment Step
app.post('/api/admin/update-payment', (req, res) => {
    const { bookingId, stepIndex } = req.body;
    const booking = bookings.find(b => b.bookingId === bookingId);
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    const idx = Number(stepIndex);
    booking.paymentStep = idx;
    booking.status = PAYMENT_STAGES[idx];

    res.json({ success: true, booking });
});

// 8. Admin Update Capacity
app.post('/api/admin/update-capacity', (req, res) => {
    const { center, capacity } = req.body;
    if (center && capacity) {
        centerCapacity[center] = Number(capacity);
        return res.json({ success: true, centerCapacity });
    }
    res.status(400).json({ success: false, error: 'Invalid capacity' });
});

// 9. Admin Update Served Token
app.post('/api/admin/update-token-progress', (req, res) => {
    const { center, date, session, currentTokenSeq } = req.body;
    const key = `${center}_${date}_${session}`;
    activeTokens[key] = Number(currentTokenSeq);
    res.json({ success: true, currentServedToken: activeTokens[key] });
});

// 10. Admin Export Excel
app.get('/api/admin/export-excel', (req, res) => {
    try {
        const exportData = bookings.map(item => ({
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

// 11. Feedback
app.post('/api/feedback', (req, res) => {
    const { name, mobile, message } = req.body;
    feedbacks.push({ name, mobile, message, date: new Date() });
    res.json({ success: true, message: 'Feedback submitted successfully' });
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'), (err) => {
        if (err) res.sendFile(path.join(__dirname, 'ux', 'index.html'));
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
