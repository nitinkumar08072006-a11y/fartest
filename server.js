const express = require('express');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'ux')));

// Fixed price per kg managed by backend
const PRICE_CONFIG = {
    "Wheat": 25,
    "Rice": 32,
    "Cotton": 65,
    "Mustard": 55,
    "Soybean": 48
};

// In-memory data store
let farmers = [];
let slotsData = [];

const PAYMENT_STAGES = [
    "Verification from District Nodal Officer",
    "Verification from Ministry",
    "Ministry to PFMS Transfer",
    "Money Transferred"
];

// Helper to generate Registration Number
function generateRegNo() {
    return 'REG-' + Math.floor(100000 + Math.random() * 900000);
}

// 1. Farmer Registration
app.post('/api/register', (req, res) => {
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
        paymentStep: 0, // 0 to 3
        status: PAYMENT_STAGES[0]
    };

    farmers.push(newFarmer);
    slotsData.push(newFarmer);

    res.json({
        success: true,
        regNo,
        message: 'Registration successful! Use your Reg No and Password to login.'
    });
});

// 2. Farmer Login
app.post('/api/login', (req, res) => {
    const { regNo, password } = req.body;
    const farmer = farmers.find(f => f.regNo === regNo && f.password === password);
    
    if (!farmer) {
        return res.status(401).json({ error: 'Invalid Registration Number or Password' });
    }

    res.json({ success: true, farmer });
});

// 3. Fetch Farmer Dashboard Details
app.get('/api/farmer/:regNo', (req, res) => {
    const farmer = farmers.find(f => f.regNo === req.params.regNo);
    if (!farmer) return res.status(404).json({ error: 'Farmer not found' });
    res.json(farmer);
});

// 4. Admin: Get all slots with filters
app.get('/api/admin/records', (req, res) => {
    const { slotDate, crop, center } = req.query;
    let filtered = [...slotsData];

    if (slotDate) filtered = filtered.filter(f => f.slotDate === slotDate);
    if (crop) filtered = filtered.filter(f => f.crop.toLowerCase() === crop.toLowerCase());
    if (center) filtered = filtered.filter(f => f.center.toLowerCase() === center.toLowerCase());

    res.json(filtered);
});

// 5. Admin: Update Payment Step
app.post('/api/admin/update-payment', (req, res) => {
    const { regNo, stepIndex } = req.body;
    const farmer = farmers.find(f => f.regNo === regNo);
    
    if (!farmer) return res.status(404).json({ error: 'Farmer not found' });
    if (stepIndex < 0 || stepIndex >= PAYMENT_STAGES.length) {
        return res.status(400).json({ error: 'Invalid step' });
    }

    farmer.paymentStep = Number(stepIndex);
    farmer.status = PAYMENT_STAGES[stepIndex];

    res.json({ success: true, message: 'Payment status updated', currentStatus: farmer.status });
});

// 6. Admin: Download Excel file
app.get('/api/admin/export-excel', (req, res) => {
    const exportData = slotsData.map(item => ({
        "Reg No": item.regNo,
        "Farmer Name": item.name,
        "Mobile": item.mobile,
        "Crop": item.crop,
        "Quantity (Kg)": item.quantityKg,
        "Rate/Kg (INR)": item.ratePerKg,
        "Total Amount (INR)": item.totalAmount,
        "Procurement Center": item.center,
        "Slot Date": item.slotDate,
        "Payment Status": item.status
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Farmer_Slots");

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="Farmer_Slots_Report.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
