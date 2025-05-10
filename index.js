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
let mothers = [
  {
    id: 1,
    name: 'Raquel',
    type: 'mother',
    team: [],
    socketId: null
  },
  {
    id: 2,
    name: 'Caro',
    type: 'mother',
    team: [],
    socketId: null
  },
  {
    id: 3,
    name: 'Dany',
    type: 'mother',
    team: [],
    socketId: null
  }
];

// Cargamos las preguntas desde un archivo JSON

const percentageQuestions = JSON.parse(fs.readFileSync('./questions/percentage.json', 'utf-8'));
const textQuestions = JSON.parse(fs.readFileSync('./questions/text.json', 'utf-8'));
const choiceQuestions = JSON.parse(fs.readFileSync('./questions/choice.json', 'utf-8'));
const orderQuestions = JSON.parse(fs.readFileSync('./questions/order.json', 'utf-8'));

const questions = {
  percentage: percentageQuestions,
  text: textQuestions,
  choice: choiceQuestions,
  order: orderQuestions
};

let currentRound = {
  question: null,
  type: null,
  answers: {}, // clave: playerId, valor: número (slider)
};

// Endpoints
// La aplicación consiste en lo siguiente:
// 1. Un jugador puede entrar a la sala como jefe "mother" o como jugador "hijo". Habrán 3 jefes predefinidos y los jugadores pueden unirse al jefe que quieran.
// 2. Una vez se hayan unido todos se puede iniciar el juego y se seleccionará un tipo de pregunta al azar. 
// 3. Por el tipo de pregunta se seleccionará una de las preguntas del tipo seleccionado y se enviará a todos los jugadores.
// 4. Dependiendo del tipo de pregunta el flujo de estas será diferente:
// 4.1. Porcentaje: se envia una pregunta y dos valores extremos. Los participantes con un slider deben elegir un valor entre los dos extremos. El jefe igual lo hará. Los jugadores con valores más cercanos al jefe ganan un punto.
// 4.2. Pregunta de texto: Se envía una pregunta que se debe responder con una palabra. El jefe igual lo hará. Los jugadores que respondan igual que el jefe ganan un punto.
// 4.3. Pregunta de texto y elección: Se envía una pregunta que se debe responder con una palabra. El jefe espera a que todos los jugadores respondan y luego elige una de las respuestas. Los jugadores que respondan igual que el jefe ganan un punto.
// 4.4. Pregunta de elección: Se envía una pregunta y varias opciones. El jefe igual lo hará. Los jugadores que respondan igual que el jefe ganan un punto.
// 4.5. Pregunta de orden: Se envía una pregunta y varias opciones. Los jugadores y el jefe deben ordenar las opciones. Los jugadores que respondan igual que el jefe ganan un punto.
// 5. Al final de cada pregunta se envía el resultado a todos los jugadores y se actualiza la puntuación de cada jugador.

app.post('/api/restart', (req, res) => {
  currentRound = {
    question: null,
    type: null,
    answers: {}, // clave: playerId, valor: número (slider)
  };

  mothers.forEach(mother => {
    mother.team = [];
    mother.socketId = null;
  });

  res.json({ message: 'Juego reiniciado' });
});


app.get('/api/mothers', (req, res) => {
  res.json(mothers);
});

app.post('/api/players', (req, res) => {
  const { name, id_mother } = req.body;
  const mother = mothers.find(m => m.id === id_mother);
  if (!mother) {
    // Entonces el jugador es mother, buscamos por nombre
    const mother = mothers.find(m => m.name === name);
    if (!mother) {
      return res.status(400).json({ message: 'Mother no encontrada' });
    }
    mother.socketId = req.body.socketId;

    res.json({ message: 'Mother added', mother });
    return;
  }

  const player = {
    id: Date.now() + Math.random(),	
    name,
    score: 0,
    type: 'player',
  };

  mother.team.push(player);

  io.emit('teams', mothers); // Enviar a todos los jugadores

  res.json({ message: 'Player added', player });
});

app.post('/api/start', (req, res) => {
  io.emit('start_game'); // Enviar a todos los jugadores
  res.json({ message: 'Juego iniciado' });
}
);

app.post('/api/category', (req, res) => {
  console.log('Categoría seleccionada:', req.body);
  const { category } = req.body;
  const questionList = questions[category];
  const randomQuestion = questionList[Math.floor(Math.random() * questionList.length)];

  let currentQuestion = {
    ...randomQuestion,
    type: category
  };

  io.emit('new_question', currentQuestion); // Enviar a todos los jugadores
  res.json({ message: 'Juego iniciado', question: currentQuestion });
});


// Socket.io
io.on('connection', (socket) => {
  console.log('🔌 Usuario conectado:', socket.id);

  socket.on('answer', (data) => {
    const { playerId, value, isMother, motherId } = data;

    // Guardamos la respuesta
    currentRound.answers[playerId] = {
      value,
      isMother,
      motherId
    };

    // Estandarizamos para algunos casos
    if (currentRound.type === 'text') {
      currentRound.answers[playerId].value = value.trim().toLowerCase();
    }

    if (currentRound.type === 'percentage') {
      // Si todos en ese equipo (incluyendo la madre) respondieron, evaluamos
      const mother = mothers.find(m => m.id === motherId);
      const totalTeamSize = mother.team.length + 1; // +1 por la madre
      const teamAnswers = Object.values(currentRound.answers).filter(a => a.motherId === motherId);

      if (teamAnswers.length === totalTeamSize) {
        evaluatePercentageRound(motherId);
      }
    } else if (currentRound.type === 'text') {
        // Comprobar si todos del equipo han respondido
      const mother = mothers.find(m => m.id === motherId);
      const totalTeamSize = mother.team.length + 1;
      const teamAnswers = Object.values(currentRound.answers).filter(a => a.motherId === motherId);

      if (teamAnswers.length === totalTeamSize) {
        evaluateTextRound(motherId);
      }
    } else if (currentRound.type === 'choice') {
      const mother = mothers.find(m => m.id === motherId);
      const totalTeamSize = mother.team.length + 1; // +1 por la madre
      const teamAnswers = Object.values(currentRound.answers).filter(a => a.motherId === motherId);

      if (teamAnswers.length === totalTeamSize) {
        evaluateChoiceRound(motherId);
      }
    } else if (currentRound.type === 'order') {
      const mother = mothers.find(m => m.id === motherId);
      const totalTeamSize = mother.team.length + 1;
      const teamAnswers = Object.values(currentRound.answers).filter(a => a.motherId === motherId);

      if (teamAnswers.length === totalTeamSize) {
        evaluateOrderRound(motherId);
      }
    }
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





function evaluatePercentageRound(motherId) {
  const teamAnswers = Object.entries(currentRound.answers)
    .filter(([_, a]) => a.motherId === motherId);

  const motherAnswer = teamAnswers.find(([_, a]) => a.isMother);
  if (!motherAnswer) return;

  const motherValue = motherAnswer[1].value;

  // Encontrar la madre
  const mother = mothers.find(m => m.id === motherId);

  const results = [];

  for (const [playerId, answer] of teamAnswers) {
    if (answer.isMother) continue;

    const distance = Math.abs(answer.value - motherValue);
    const player = mother.team.find(p => p.id == playerId);
    if (!player) continue;

    results.push({
      playerId,
      name: player.name,
      playerValue: answer.value,
      motherValue,
      distance
    });
  }

  // Ordenamos por menor distancia
  results.sort((a, b) => a.distance - b.distance);

  // Los más cercanos (puedes cambiar la lógica si hay empate)
  const closest = results[0];
  const winner = mother.team.find(p => p.id == closest.playerId);
  if (winner) {
    winner.score = (winner.score || 0) + 1;
  }

  // Enviar resultados
  io.emit('round_result', {
    mothers
  });

  // Limpiar respuestas
  currentRound.answers = {};
}

function evaluateTextRound(motherId) {
  const teamAnswers = Object.entries(currentRound.answers)
    .filter(([_, a]) => a.motherId === motherId);

  const motherEntry = teamAnswers.find(([_, a]) => a.isMother);
  if (!motherEntry) return;

  const motherAnswer = motherEntry[1].value;

  const mother = mothers.find(m => m.id === motherId);
  const results = [];

  for (const [playerId, answer] of teamAnswers) {
    if (answer.isMother) continue;

    const player = mother.team.find(p => p.id == playerId);
    if (!player) continue;

    const match = answer.value === motherAnswer;

    if (match) {
      player.score = (player.score || 0) + 1;
    }

    results.push({
      playerId,
      name: player.name,
      answer: answer.value,
      motherAnswer,
      correct: match
    });
  }

  io.emit('round_result', {
    mothers
  });

  currentRound.answers = {};
}

function evaluateChoiceRound(motherId) {
  const teamAnswers = Object.entries(currentRound.answers)
    .filter(([_, a]) => a.motherId === motherId);

  const motherAnswer = teamAnswers.find(([_, a]) => a.isMother);
  if (!motherAnswer) return;

  const motherChoice = motherAnswer[1].value;

  const mother = mothers.find(m => m.id === motherId);
  const results = [];

  for (const [playerId, answer] of teamAnswers) {
    if (answer.isMother) continue;

    const player = mother.team.find(p => p.id == playerId);
    if (!player) continue;

    const correct = answer.value === motherChoice;
    if (correct) {
      player.score = (player.score || 0) + 1;
    }

    results.push({
      playerId,
      name: player.name,
      answer: answer.value,
      correct
    });
  }

  io.emit('round_result', {
    mothers
  });

  currentRound.answers = {};
}

function arraysEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((val, i) => val === b[i]);
}

function evaluateOrderRound(motherId) {
  const teamAnswers = Object.entries(currentRound.answers)
    .filter(([_, a]) => a.motherId === motherId);

  const motherEntry = teamAnswers.find(([_, a]) => a.isMother);
  if (!motherEntry) return;

  const correctOrder = motherEntry[1].value;

  const mother = mothers.find(m => m.id === motherId);
  const results = [];

  for (const [playerId, answer] of teamAnswers) {
    if (answer.isMother) continue;

    const player = mother.team.find(p => p.id == playerId);
    if (!player) continue;

    const correct = arraysEqual(answer.value, correctOrder);
    if (correct) {
      player.score = (player.score || 0) + 1;
    }

    results.push({
      playerId,
      name: player.name,
      answer: answer.value,
      correct
    });
  }

  io.emit('round_result', {
    mothers
  });

  currentRound.answers = {};
}
