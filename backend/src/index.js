require('dotenv').config();
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const { getDb }          = require('./config/database');
const { initSockets }    = require('./sockets');

const authRoutes      = require('./routes/auth');
const examRoutes      = require('./routes/exams');
const sessionRoutes   = require('./routes/sessions');
const violationRoutes = require('./routes/violations');
const resultRoutes    = require('./routes/results');

const app    = express();
const server = http.createServer(app);

// Allow any origin — needed for cross-device LAN demos.
// In production, restrict this to your actual domain.
const corsOptions = {
  origin: true,   // reflect the request origin (allows any device on the network)
  credentials: true,
};

const io = new Server(server, {
  cors: corsOptions,
  // Increase buffer for webcam frames
  maxHttpBufferSize: 5e6,
});

app.set('io', io);

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

getDb();

app.use('/api/auth',       authRoutes);
app.use('/api/exams',      examRoutes);
app.use('/api/sessions',   sessionRoutes);
app.use('/api/violations', violationRoutes);
app.use('/api/results',    resultRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

initSockets(io);

const PORT = process.env.PORT || 4000;
// Listen on all interfaces so other devices on the LAN can reach the backend
server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  const ips  = Object.values(nets).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log(`\n🔒 LockLens Backend running on port ${PORT}`);
  console.log(`   Local:    http://localhost:${PORT}`);
  if (ips.length) console.log(`   Network:  http://${ips[0]}:${PORT}  (use this for other devices)`);
  console.log(`📡 WebSocket server ready\n`);
});

module.exports = { app, server };
