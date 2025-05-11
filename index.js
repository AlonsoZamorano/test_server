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
  console.log('Reiniciando juego...');
  currentRound = {
    question: null,
    type: null,
    answers: {}, // clave: playerId, valor: número (slider)
  };

  mothers.forEach(mother => {
    mother.team = [];
    mother.socketId = null;
  });

  percentageQuestions = JSON.parse(fs.readFileSync('./questions/percentage.json', 'utf-8'));
  textQuestions = JSON.parse(fs.readFileSync('./questions/text.json', 'utf-8'));
  choiceQuestions = JSON.parse(fs.readFileSync('./questions/choice.json', 'utf-8'));
  orderQuestions = JSON.parse(fs.readFileSync('./questions/order.json', 'utf-8'));

  questions = {
    percentage: percentageQuestions,
    text: textQuestions,
    choice: choiceQuestions,
    order: orderQuestions
  };

  res.json({ message: 'Juego reiniciado' });
});


app.get('/api/mothers', (req, res) => {
  res.json(mothers);
});

app.post('/api/players', (req, res) => {
  const { name, id_mother } = req.body;
  console.log('Unirse como jugador:', req.body);
  if (!id_mother) {
    // Entonces el jugador es mother, buscamos por nombre
    const mother = mothers.find(m => m.name === name);
    if (!mother) {
      return res.status(400).json({ message: 'Mother no encontrada' });
    }
    mother.socketId = true;

    io.emit('teams', mothers); // Enviar a todos los jugadores

    res.json({ message: 'Mother added', player: mother });
    return;
  }
  
  const mother = mothers.find(m => m.id === id_mother);

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
  // Eliminamos la pregunta de la lista para que no se repita
  const questionIndex = questionList.indexOf(randomQuestion);
  if (questionIndex > -1) {
    questionList.splice(questionIndex, 1);
  }

  let currentQuestion = {
    ...randomQuestion,
    type: category
  };

  // Guardamos los datos de la ronda actual
  currentRound.question = currentQuestion.question;
  currentRound.type = currentQuestion.type;

  io.emit('new_question', currentQuestion); // Enviar a todos los jugadores
  res.json({ message: 'Juego iniciado', question: currentQuestion });
});


// Socket.io
io.on('connection', (socket) => {
  console.log('🔌 Usuario conectado:', socket.id);

  socket.on('answer', (data) => {
    const { playerId, value, isMother, motherId } = data;
    console.log('Respuesta recibida:', data);

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

    // Debemos comprobar que todos los jugadores en la partida respondieron (incluyendo la madre). Comparamos la cantidad de respuestas de la ronda con la cantidad de jugadores almacenados en la partida.
    // Para esto revisamos en mothers si el socketId no es null y sumamos 1, luego sumamos la cantidad de jugadores en todos los equipos donde el socketId de la madre no es null.
    const totalPlayers = mothers.reduce((acc, mother) => {
      if (mother.socketId) {
        acc += 1;
      }
      acc += mother.team.length;

      return acc;
    }, 0);
    const totalAnswers = Object.keys(currentRound.answers).length;

    console.log('Total de jugadores:', totalPlayers);
    console.log('Total de respuestas:', totalAnswers);
    // obtener laststate de mothers
    let lastStateMothers = JSON.parse(JSON.stringify(mothers)); // Copia profunda antes de evaluar

    if (totalAnswers === totalPlayers) {
      console.log('Todos los jugadores respondieron');
      // Si todos en ese equipo (incluyendo la madre) respondieron, evaluamos
      if (currentRound.type === 'percentage') {
        mothers.forEach(mother => {
          if (mother.socketId) {
            evaluatePercentageRound(mother.id);
          }
        });
      } else if (currentRound.type === 'text') {
        mothers.forEach(mother => {
          if (mother.socketId) {
            evaluateTextRound(mother.id);
          }
        });
      } else if (currentRound.type === 'choice') {
        mothers.forEach(mother => {
          if (mother.socketId) {
            evaluateChoiceRound(mother.id);
          }
        });
      } else if (currentRound.type === 'order') {
        mothers.forEach(mother => {
          if (mother.socketId) {
            evaluateOrderRound(mother.id);
          }
        });
      }
      
      console.log('Resultados de la ronda:', mothers);
      
      io.emit('round_result', {
        mothers,
        winners: getWinners(lastStateMothers, mothers)
      });

      // Limpiar respuestas
      currentRound.answers = {};
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


function getWinners(lastStateMothers, currentStateMothers) {
  // Comparamos el estado anterior con el actual y obtenemos los ganadores, estos serán aquellos jugadores que tengan un score mayor al anterior.
  const winners = [];
  for (const mother of lastStateMothers) {
    const currentMother = currentStateMothers.find(m => m.id === mother.id);
    if (!currentMother) continue;

    for (const player of mother.team) {
      const currentPlayer = currentMother.team.find(p => p.id === player.id);
      if (!currentPlayer) continue;

      if (currentPlayer.score > player.score) {
        winners.push({
          playerId: player.id,
          name: player.name,
          score: currentPlayer.score - player.score
        });
      }
    }
  }
  return winners;
}


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
}

function evaluateTextRound(motherId) {
  const teamAnswers = Object.entries(currentRound.answers)
    .filter(([_, a]) => a.motherId === motherId);
  
  console.log('teamAnswers', teamAnswers);

  const motherEntry = teamAnswers.find(([_, a]) => a.isMother);
  if (!motherEntry) return;

  const motherAnswer = motherEntry[1].value;

  console.log('motherAnswer', motherAnswer);

  const mother = mothers.find(m => m.id === motherId);

  for (const [playerId, answer] of teamAnswers) {
    if (answer.isMother) continue;

    const player = mother.team.find(p => p.id == playerId);
    if (!player) continue;

    console.log('playerId', playerId);

    const match = answer.value === motherAnswer;
    console.log('match', match);

    if (match) {
      player.score = (player.score || 0) + 1;
    }
    console.log('player.score', player.score);
  }
}

function evaluateChoiceRound(motherId) {
  const teamAnswers = Object.entries(currentRound.answers)
    .filter(([_, a]) => a.motherId === motherId);

  const motherAnswer = teamAnswers.find(([_, a]) => a.isMother);
  if (!motherAnswer) return;

  const motherChoice = motherAnswer[1].value;

  const mother = mothers.find(m => m.id === motherId);

  for (const [playerId, answer] of teamAnswers) {
    if (answer.isMother) continue;

    const player = mother.team.find(p => p.id == playerId);
    if (!player) continue;

    const correct = answer.value === motherChoice;
    if (correct) {
      player.score = (player.score || 0) + 1;
    }
  }
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

  for (const [playerId, answer] of teamAnswers) {
    if (answer.isMother) continue;

    const player = mother.team.find(p => p.id == playerId);
    if (!player) continue;

    const correct = arraysEqual(answer.value, correctOrder);
    if (correct) {
      player.score = (player.score || 0) + 1;
    }
  }
}
