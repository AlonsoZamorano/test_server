import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import helmet from 'helmet';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middlewares
app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Datos
let players = [];

let cultura_chupistica_questions = JSON.parse(fs.readFileSync('./questions/cultura_chupistica.json', 'utf-8'));
let quien_sabe_mas_questions = JSON.parse(fs.readFileSync('./questions/quien_sabe_mas.json', 'utf-8'));
let retos_questions = JSON.parse(fs.readFileSync('./questions/retos.json', 'utf-8'));
let una_palabra_questions = JSON.parse(fs.readFileSync('./questions/una_palabra.json', 'utf-8'));
let votacion_questions = JSON.parse(fs.readFileSync('./questions/votacion.json', 'utf-8'));

// Endpoints

app.get('/ping', (req, res) => {
  res.send('pong');
});

app.get('/questions', (req, res) => {
  const allQuestions = [
    ...cultura_chupistica_questions.map(q => ({ ...q, category: 'cultura_chupistica' })),
    ...quien_sabe_mas_questions.map(q => ({ ...q, category: 'quien_sabe_mas' })),
    ...retos_questions.map(q => ({ ...q, category: 'retos' })),
    ...una_palabra_questions.map(q => ({ ...q, category: 'una_palabra' })),
    ...votacion_questions.map(q => ({ ...q, category: 'votacion' })),
  ];
  res.json(allQuestions);
});

app.get('/players', (req, res) => {
  res.json(players);
});

app.post('/players', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  if (players.find(p => p.name === name)) {
    return res.status(409).json({ error: 'Player already exists' });
  }

  const player = { id: Date.now(), name, score: 0 };
  players.push(player);

  io.emit('player_joined', player);
  res.status(200).json(player);

  // 🔽 CAMBIA AQUÍ LA CATEGORÍA PARA PROBAR DIFERENTES TIPOS
  const category = 'cultura_chupistica'; // opciones: 'retos', 'quien_sabe_mas', 'cultura_chupistica', 'una_palabra', 'votacion'

  let questions = [];
  switch (category) {
    case 'cultura_chupistica':
      questions = cultura_chupistica_questions;
      break;
    case 'quien_sabe_mas':
      questions = quien_sabe_mas_questions;
      break;
    case 'retos':
      questions = retos_questions;
      break;
    case 'una_palabra':
      questions = una_palabra_questions;
      break;
    case 'votacion':
      questions = votacion_questions;
      break;
  }

  const randomIndex = Math.floor(Math.random() * questions.length);
  const question = questions[randomIndex];

  // Si el tipo de pregunta es "votacion" y "type": "players" entonces como "options" se envían los jugadores
  if (category === 'votacion' && question.type === 'players') {
    question.options = players.map(player => player.name);
  }

  question.category = category;

  console.log(`🚀 Enviando pregunta de tipo "${category}":`, question);
  io.emit("question", question);
});


app.post('/category', (req, res) => {
  const { category } = req.body;

  let questions = [];
  switch (category) {
    case 'cultura_chupistica':
      questions = cultura_chupistica_questions;
      break;
    case 'quien_sabe_mas':
      questions = quien_sabe_mas_questions;
      break;
    case 'retos':
      questions = retos_questions;
      break;
    case 'una_palabra':
      questions = una_palabra_questions;
      break;
    case 'votacion':
      questions = votacion_questions;
      break;
    default:
      return res.status(400).json({ error: 'Categoría no válida' });
  }

  const randomIndex = Math.floor(Math.random() * questions.length);
  const question = questions[randomIndex];

  question.category = category;

  console.log('📝 Pregunta seleccionada:', question);
  console.log('📂 Categoría:', category);

  io.emit("question", question);
  res.status(200).json(question);
});

app.post('/answer', (req, res) => {
  const { playerId, answer } = req.body;
  if (!playerId || answer === undefined) return res.status(400).json({ error: 'Player ID and answer are required' });

  const player = players.find(p => p.id === playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  player.score += answer ? 1 : 0;
  io.emit('answer_received', { playerId, answer });
  res.status(200).json({ message: 'Answer received' });
});

// Socket.io
io.on('connection', (socket) => {
  console.log('🔌 Usuario conectado:', socket.id);

  socket.on('answer', (data) => {
    console.log('✅ Respuesta recibida:', data);
    io.emit('answer_received', data);
  });

  socket.on('disconnect', () => {
    console.log('❌ Usuario desconectado:', socket.id);
  });
});

// Servidor
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Servidor corriendo en http://0.0.0.0:${PORT}`);
});
