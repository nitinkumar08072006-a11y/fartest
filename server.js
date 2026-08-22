const express = require('express');
const path = require('path');
const cors = require('cors');
const XLSX = require('xlsx');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'ux' folder
app.use(express.static(path.join(__dirname, 'ux')));

// Fixed price per kg configuration
const PRICE_CONFIG = {
    "Wheat": 25,
    "Rice": 32,
    "Cotton": 65,
    "Mustard": 55,
    "Soybean": 48
};

// Payment pipeline stages
const PAYMENT_STAGES = [
    "Verification from District Nodal Officer",
    "Verification from Ministry",
    "Ministry to PFMS Transfer",
    "Money Transferred"
];

// In-memory data storage
let farmers = [];
let slotsData = [];

function generateRegNo() {
    return 'REG-' + Math.floor(100000 + Math.random() * 900000);
}

// 1. Farmer Registration
app.post('/api/register', (req, res) => {
    try {
        const { name, mobile, crop, quantityKg, center, slotDate, password } = req.body;
        
        if (!name || !password || !crop || !quantityKg) {
            return res.status(400).json({ error: 'All mandatory fields are required' });
        }

        const regNo = generateRegNo();
        const ratePerKg = PRICE_CONFIG[crop] || 20;
        const totalAmount = ratePerKg * Number(quantityKg);

        const newFarmer = {
            regNo,
            password,
            name,
            mobile,
            crop,
            quantityKg: Number(quantityKg),
            ratePerKg,
            totalAmount,
            center: center || 'Center A',
            slotDate: slotDate || new Date().toISOString().split('T')[0],
            paymentStep: 0,
            status: PAYMENT_STAGES[0]
        };

        farmers.push(newFarmer);
        slotsData.push(newFarmer);

        res.json({
            success: true,
            regNo,
            message: 'Registration successful!'
        });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 2. Farmer Login
app.post('/api/login', (req, res) => {
    try {
        const { regNo, password } = req.body;
        const farmer = farmers.find(f => f.regNo === regNo && f.password === password);
        
        if (!farmer) {
            return res.status(401).json({ error: 'Invalid Registration Number or Password' });
        }

        res.json({ success: true, farmer });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 3. Admin: Fetch Filtered Records
app.get('/api/admin/records', (req, res) => {
    const { slotDate, crop, center } = req.query;
    let filtered = [...slotsData];

    if (slotDate) filtered = filtered.filter(f => f.slotDate === slotDate);
    if (crop) filtered = filtered.filter(f => f.crop.toLowerCase().includes(crop.toLowerCase()));
    if (center) filtered = filtered.filter(f => f.center.toLowerCase().includes(center.toLowerCase()));

    res.json(filtered);
});

// 4. Admin: Update Payment Step
app.post('/api/admin/update-payment', (req, res) => {
    const { regNo, stepIndex } = req.body;
    const farmer = farmers.find(f => f.regNo === regNo);
    
    if (!farmer) return res.status(404).json({ error: 'Farmer not found' });
    const idx = Number(stepIndex);
    if (idx < 0 || idx >= PAYMENT_STAGES.length) {
        return res.status(400).json({ error: 'Invalid stage index' });
    }

    farmer.paymentStep = idx;
    farmer.status = PAYMENT_STAGES[idx];

    res.json({ success: true, message: 'Status updated', currentStatus: farmer.status });
});

// 5. Admin: Export Data to Excel
app.get('/api/admin/export-excel', (req, res) => {
    try {
        const exportData = slotsData.map(item => ({
            "Registration No": item.regNo,
            "Farmer Name": item.name,
            "Mobile Number": item.mobile,
            "Crop Type": item.crop,
            "Quantity (Kg)": item.quantityKg,
            "Rate per Kg (₹)": item.ratePerKg,
            "Total Payout (₹)": item.totalAmount,
            "Procurement Center": item.center,
            "Slot Date": item.slotDate,
            "Payment Status": item.status
        }));

        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Farmer_Records");

        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', 'attachment; filename="Farmer_Slots_Report.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        res.status(500).send('Error generating Excel file');
    }
});

// Default fallback to index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'ux', 'index.html'));
});

// Dynamic port configuration for Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
