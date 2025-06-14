import express from 'express';
import { createServer, get } from 'http';
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

app.use(cors());
app.use(helmet());
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// Definimos los objetos jugadores (padre e hijos)
// Cada jugador tiene un token, ID, nombre, si es padre o hijo, y una lista de hijos si es un padre

// Las rondas seran objetos que contienen el numero de la ronda, la categoria de la pregunta, la pregunta actual, la respuesta correcta y las respuestas de los jugadores
let players = {};

// Cargamos en forma de json las preguntas de cada categoria
const knowledgeQuestions = JSON.parse(fs.readFileSync('knowledge_questions.json', 'utf8'));
const selectQuestions = JSON.parse(fs.readFileSync('select_questions.json', 'utf8'));
const fatherChooseQuestions = JSON.parse(fs.readFileSync('father_choose_questions.json', 'utf8'));
const surveyQuestions = JSON.parse(fs.readFileSync('survey_questions.json', 'utf8'));
const sliderQuestions = JSON.parse(fs.readFileSync('slider_questions.json', 'utf8'));

const categories = {
  knowledge: knowledgeQuestions,
  select: selectQuestions,
  fatherChoose: fatherChooseQuestions,
  survey: surveyQuestions,
  slider: sliderQuestions
};

let currentRound = {
  allQuestions: {
    knowledge: knowledgeQuestions,
    select: selectQuestions,
    fatherChoose: fatherChooseQuestions,
    survey: surveyQuestions,
    slider: sliderQuestions
  },
  roundNumber: 0,
  category: '',
  currentQuestion: '',
  correctAnswer: '',
  playerAnswers: {}
};

io.on('connection', (socket) => {
  console.log('Nuevo cliente conectado:', socket.id);

  // Manejo de eventos de conexión
  socket.on('registerPlayer', (data) => {
    const { token, name, isParent } = data;
    let  id = socket.id;
    players[token] = {
      id: id,
      token: token,
      name: name,
      isParent: isParent,
      children: []
    };
    console.log(`Jugador registrado: ${name} (${isParent ? 'Padre' : 'Hijo'})`);
    socket.emit('playerRegistered', players[id]);
  });

  // Manejo de eventos de desconexión
  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// Endpoint para reconectar un jugador
app.post('/reconnectPlayer', (req, res) => {
  const { token } = req.body;
  const player = players[token];

  if (!player) {
    return res.status(404).json({ error: 'Jugador no encontrado' });
  }

  // Reasignamos el socket ID al jugador
  player.id = req.socket.id;
  console.log(`Jugador reconectado: ${player.name}`);
  
  res.json({ success: true, player });
});

// Endpoint para obtener la lista de jugadores
app.get('/players', (req, res) => {
  res.json(Object.values(players));
});

// Endpoint para obtener la información de una ronda actual
app.get('/currentRound', (req, res) => {
  res.json(currentRound);
});

// Endpoint para ingresar una respuesta (viene con la token del jugador)
app.post('/submitAnswer', (req, res) => {
  const { token, answer } = req.body;
  const player = Object.values(players).find(p => p.token === token);
  
  if (!player) {
    return res.status(404).json({ error: 'Jugador no encontrado' });
  }

  // Aquí podrías manejar la lógica de la respuesta
  console.log(`Respuesta recibida de ${player.name}: ${answer}`);
  // Guardamos la respuesta en la ronda
  currentRound.playerAnswers[player.id] = answer;
  
  res.json({ success: true, message: 'Respuesta recibida' });
});


// Endpoint para iniciar una nueva ronda
app.post('/startRound', (req, res) => {
  const { category, correctAnswer } = req.body;

  let question = getRandomQuestion(category);

  currentRound.roundNumber++;
  currentRound.category = category;
  currentRound.currentQuestion = question;
  currentRound.correctAnswer = correctAnswer;
  currentRound.playerAnswers = {};

  console.log(`Nueva ronda iniciada: ${currentRound.roundNumber} - Categoría: ${category}`);
  
  // Emitimos el evento a todos los jugadores
  io.emit('newRound', currentRound);

  res.json({ success: true, message: 'Ronda iniciada', round: currentRound });
});

// Endpoint resultados de la ronda

// Función para obtener una pregunta aleatoria de una categoría
function getRandomQuestion(category) {
  // Escoge de manera aleatoria una pregunta de la categoría especificada y luego la elimina de la lista para que no se repita
  const questions = currentRound.allQuestions[category];
  if (!questions || questions.length === 0) {
    throw new Error(`No hay preguntas disponibles para la categoría: ${category}`);
  }
  const randomIndex = Math.floor(Math.random() * questions.length);
  const question = questions[randomIndex];
  // Elimina la pregunta de la lista para que no se repita
  currentRound.allQuestions[category].splice(randomIndex, 1);
  return question;
}
  
// Iniciamos el servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});