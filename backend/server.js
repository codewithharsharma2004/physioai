// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 3000;

mongoose.connect(MONGODB_URI).then(() => {
    console.log('MongoDB connected');
}).catch((err) => {
    console.error('MongoDB connection error:', err);
});

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['patient', 'doctor'], required: true },
    specialization: { type: String },
    createdAt: { type: Date, default: Date.now }
});

const consultationSchema = new mongoose.Schema({
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    roomId: { type: String, required: true, unique: true },
    status: { type: String, enum: ['waiting', 'active', 'completed'], default: 'waiting' },
    createdAt: { type: Date, default: Date.now },
    completedAt: { type: Date }
});

const prescriptionSchema = new mongoose.Schema({
    consultationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation', required: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    diagnosis: { type: String, required: true },
    medications: [{ type: String }],
    instructions: { type: String, required: true },
    followUp: { type: String },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Consultation = mongoose.model('Consultation', consultationSchema);
const Prescription = mongoose.model('Prescription', prescriptionSchema);

const authenticate = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token required' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) return res.status(401).json({ error: 'Invalid token' });
        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/intro.html'));
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, role, specialization } = req.body;
        if (!name || !email || !password || !role) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ error: 'User already exists' });
        const hashed = await bcrypt.hash(password, 10);
        const user = await User.create({
            name,
            email,
            password: hashed,
            role,
            specialization: role === 'doctor' ? specialization : undefined
        });
        const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, specialization: user.specialization } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email & password required' });
        const user = await User.findOne({ email });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, specialization: user.specialization } });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/api/auth/me', authenticate, (req, res) => {
    const user = req.user;
    res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role, specialization: user.specialization } });
});

app.post('/api/consultations/request', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'patient') return res.status(403).json({ error: 'Patients only' });
        const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const consultation = await Consultation.create({ patientId: req.user._id, roomId });
        io.to('doctors').emit('new-patient', {
            consultationId: consultation._id,
            patientName: req.user.name,
            roomId
        });
        res.json({ consultationId: consultation._id, roomId, status: consultation.status });
    } catch (err) {
        res.status(500).json({ error: 'Unable to request consultation' });
    }
});

app.get('/api/consultations/waiting', authenticate, async (req, res) => {
    if (req.user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
    const waiting = await Consultation.find({ status: 'waiting' }).populate('patientId', 'name email').sort({ createdAt: -1 });
    res.json(waiting);
});

app.post('/api/consultations/accept', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
        const { consultationId } = req.body;
        const consultation = await Consultation.findById(consultationId);
        if (!consultation) return res.status(404).json({ error: 'Consultation not found' });
        if (consultation.status !== 'waiting') return res.status(400).json({ error: 'Consultation not available' });
        consultation.status = 'active';
        consultation.doctorId = req.user._id;
        await consultation.save();
        io.to(consultation.patientId.toString()).emit('consultation-accepted', {
            consultationId: consultation._id,
            doctorName: req.user.name,
            roomId: consultation.roomId
        });
        res.json({ consultationId: consultation._id, roomId: consultation.roomId, status: consultation.status });
    } catch (err) {
        res.status(500).json({ error: 'Unable to accept consultation' });
    }
});

app.get('/api/prescriptions', authenticate, async (req, res) => {
    const filter = req.user.role === 'patient' ? { patientId: req.user._id } : { doctorId: req.user._id };
    const prescriptions = await Prescription.find(filter)
        .populate('doctorId', 'name specialization')
        .populate('patientId', 'name email')
        .sort({ createdAt: -1 });
    res.json(prescriptions);
});

app.post('/api/prescriptions', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'doctor') return res.status(403).json({ error: 'Doctors only' });
        const { consultationId, diagnosis, medications = [], instructions, followUp } = req.body;
        if (!consultationId || !diagnosis || !instructions) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const consultation = await Consultation.findById(consultationId);
        if (!consultation || consultation.doctorId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Invalid consultation' });
        }
        const prescription = await Prescription.create({
            consultationId,
            patientId: consultation.patientId,
            doctorId: req.user._id,
            diagnosis,
            medications,
            instructions,
            followUp
        });
        io.to(consultation.patientId.toString()).emit('prescription-ready', {
            prescriptionId: prescription._id,
            consultationId: consultation._id
        });
        res.json(prescription);
    } catch (err) {
        res.status(500).json({ error: 'Could not create prescription' });
    }
});

io.on('connection', (socket) => {
    socket.on('register-user', (data) => {
        if (data && data.userId) {
            socket.join(data.userId);
        }
    });

    socket.on('join-as-doctor', () => {
        socket.join('doctors');
    });

    socket.on('join-room', (roomId) => {
        socket.join(roomId);
    });

    socket.on('offer', ({ roomId, offer }) => {
        socket.to(roomId).emit('offer', { offer });
    });

    socket.on('answer', ({ roomId, answer }) => {
        socket.to(roomId).emit('answer', { answer });
    });

    socket.on('ice-candidate', ({ roomId, candidate }) => {
        socket.to(roomId).emit('ice-candidate', { candidate });
    });

    socket.on('chat-message', ({ roomId, from, message }) => {
        socket.to(roomId).emit('chat-message', { from, message, timestamp: new Date().toISOString() });
    });
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
