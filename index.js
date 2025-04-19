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
let currentQuestion = null;
let retoPlayer = null;
let orderCulturaChupistica = null;
let turnCulturaChupistica = null;

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
    // Si te unes con el mismo nombre te unirás como este jugador
    const existingPlayer = players.find(p => p.name === name);

    return res.status(200).json(existingPlayer);
  }

  const player = { id: Date.now(), name, score: 0 };
  players.push(player);

  io.emit('player_joined', player);
  res.status(200).json(player);
});


app.post('/category', (req, res) => {
  const { category } = req.body;
  retoPlayer = null; // Reiniciamos el jugador de reto al seleccionar una categoría
  if (!category) return res.status(400).json({ error: 'Category is required' });

  let randomPlayer = null; // Variable para almacenar el jugador aleatorio

  let questions = [];
  switch (category) {
    case 'cultura_chupistica':
      questions = cultura_chupistica_questions;
      break;
    case 'quien_sabe_mas':
      questions = quien_sabe_mas_questions;

      const randomIndex = Math.floor(Math.random() * players.length);
      randomPlayer = players[randomIndex];
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

  if (category === 'quien_sabe_mas') {
    question.target = randomPlayer;
  } else if (category === 'votacion') {
    if (question.type === "players") {
      // Entonces agregamos a los jugadores como opciones de votación
      question.options = players.map(player => player.name);
    }
  }

  currentQuestion = question;

  console.log('📝 Pregunta seleccionada:', question);
  console.log('📂 Categoría:', category);

  io.emit("question", question);
  res.status(200).json(question);
});

app.post('/register_reto', (req, res) => {
  const { playerId } = req.body;

  if (!playerId === undefined) return res.status(400).json({ error: 'Player ID and answer are required' });

  retoPlayer = players.find(p => p.id === playerId);

  if (!retoPlayer) return res.status(404).json({ error: 'Player not found' });
});

app.post('/define_order_cultura_chupistica', (req, res) => {
  const { order } = req.body;
  if (!order) return res.status(400).json({ error: 'Order is required' });

  orderCulturaChupistica = order;
  console.log('📝 Orden de cultura chupística:', orderCulturaChupistica);

  turnCulturaChupistica = orderCulturaChupistica[0]; // El primer jugador en la lista es el que inicia

  io.emit('turn_cultura_chupistica', turnCulturaChupistica);
  res.status(200).json({ message: 'Orden definido' });
}
);

app.post('/next_turn_cultura_chupistica', (req, res) => {
  if (!orderCulturaChupistica) return res.status(400).json({ error: 'Order is not defined' });

  const currentIndex = orderCulturaChupistica.indexOf(turnCulturaChupistica);
  const nextIndex = (currentIndex + 1) % orderCulturaChupistica.length;
  turnCulturaChupistica = orderCulturaChupistica[nextIndex];

  console.log('📝 Siguiente turno de cultura chupística:', turnCulturaChupistica);
  io.emit('turn_cultura_chupistica', turnCulturaChupistica);
  res.status(200).json({ message: 'Turno cambiado' });
});

app.post('/previous_turn_cultura_chupistica', (req, res) => {
  if (!orderCulturaChupistica) return res.status(400).json({ error: 'Order is not defined' });

  const currentIndex = orderCulturaChupistica.indexOf(turnCulturaChupistica);
  const previousIndex = (currentIndex - 1 + orderCulturaChupistica.length) % orderCulturaChupistica.length;
  turnCulturaChupistica = orderCulturaChupistica[previousIndex];

  console.log('📝 Turno anterior de cultura chupística:', turnCulturaChupistica);
  io.emit('turn_cultura_chupistica', turnCulturaChupistica);
  res.status(200).json({ message: 'Turno cambiado' });
}
);

app.post('/register_answer', (req, res) => {
  const { playerId, answer } = req.body;
  if (!playerId || answer === undefined) return res.status(400).json({ error: 'Player ID and answer are required' });

  const player = players.find(p => p.id === playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  // Registramos la respuesta del jugador
  player.answer = answer;
  console.log('📝 Respuesta recibida:', player);

  // Si todos los jugadores han respondido, emitimos el evento
  if (players.every(p => p.answer !== undefined)) {
    console.log('✅ Todos los jugadores han respondido:', players);

    emit_results(players);
  }
  res.status(200).json({ message: 'Respuesta registrada' });
});

function emit_results(players) {
  // En cualquiera de los casos emitimos una señal de la lista de jugadores que obtienen la respuesta correcta
  // Si es de tipo votación enviamos las opciones con el número de votos por esta y las opciones ordenadas por el número de votos
  // Si es de tipo quien_sabe_mas entonces enviamos las personas con el valor más cercano al enviado por el jugador 'target'
  // Si es de tipo una_palabra puntuan todos los que hayan respondido una palabra repetida con otro jugador
  // En reto le sumamos un punto al retoPlayer que será registrado por la aplicación central
  // En cultura_chupistica se le suma un punto a todos los jugadores que no sea el turnCulturaChupistica (pierde aquel que no alcanza a responder antes del tiempo límite)
  if (currentQuestion.type === 'votacion') {
    const results = get_votacion_results(players, currentQuestion.options);
    io.emit('results', results);

    io.emit('players_with_correct_answer', get_players_with_correct_answer(players, results[0].option));

    sum_point_to_players(get_players_with_correct_answer(players, results[0].option));
  } else if (currentQuestion.type === 'quien_sabe_mas') {
    const closestPlayers = get_closest_players(players, currentQuestion.target);
    io.emit('players_with_correct_answer', closestPlayers);

    sum_point_to_players(closestPlayers);
  } else if (currentQuestion.type === 'una_palabra') {
    const playersWithSameAnswer = get_players_with_same_answer(players);
    io.emit('players_with_correct_answer', playersWithSameAnswer);

    sum_point_to_players(playersWithSameAnswer);
  } else if (currentQuestion.type === 'retos') {
    io.emit('players_with_correct_answer', [retoPlayer]);
    sum_point_to_players([retoPlayer]);
  } else if (currentQuestion.type === 'cultura_chupistica') {
    const playersWithCorrectAnswer = players.filter(player => player.id !== turnCulturaChupistica);
    io.emit('players_with_correct_answer', playersWithCorrectAnswer);

    sum_point_to_players(playersWithCorrectAnswer);
  }

  return results;
}

function get_votacion_results(players, options) {
  const results = options.map(option => {
    const votes = players.filter(player => player.answer === option).length;
    return { option, votes };
  });

  // Ordenamos los resultados por el número de votos
  results.sort((a, b) => b.votes - a.votes);

  return results;
}

function get_closest_players(players, target) {
  const valueOfTarget = players.find(player => player.id === target.id).answer;

  const closestPlayers = players.filter(player => {
    if (player.id === target.id) return false; // No incluir al jugador objetivo
    return Math.abs(player.answer - valueOfTarget) <= 10; // Ajusta el rango según sea necesario
  }
  );

  closestPlayers.sort((a, b) => Math.abs(a.answer - valueOfTarget) - Math.abs(b.answer - valueOfTarget));

  return closestPlayers;
}

function get_players_with_same_answer(players) {
  const answerCounts = players.reduce((acc, player) => {
    acc[player.answer] = (acc[player.answer] || 0) + 1;
    return acc;
  }, {});

  const playersWithSameAnswer = players.filter(player => answerCounts[player.answer] > 1);
  return playersWithSameAnswer;
}

function get_players_with_correct_answer(players, correctAnswer) {
  const playersWithCorrectAnswer = players.filter(player => player.answer === correctAnswer);
  return playersWithCorrectAnswer;
}

function sum_point_to_players(players_list) {
  players_list.forEach(player => {
    const playerIndex = players.findIndex(p => p.id === player.id);
    if (playerIndex !== -1) {
      players[playerIndex].score += 1;
    }
  });
}

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

app.post('/start', (req, res) => {
  io.emit('start_game');
  res.status(200).json({ message: 'Juego iniciado' });
});

// Servidor
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Servidor corriendo en http://0.0.0.0:${PORT}`);
});
