const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Catálogo inicial de tarjetas Visa virtuales (En la siguiente fase irá a Base de Datos)
let visaCards = [
  {
    id: 'visa-01',
    tier: 'VISA INFINITE BLACK',
    last4: '8492',
    fullNumber: '4532 •••• •••• 8492',
    holder: 'VIRTUAL HOLDER',
    expiry: '11/28',
    cvv: '834',
    balanceLimit: '$500 USD',
    durationOptions: [
      { id: '24h', label: '24 Horas', price: 15 },
      { id: '7d', label: '7 Días', price: 35 },
      { id: '30d', label: '30 Días', price: 80 }
    ],
    theme: 'obsidian',
    available: true
  },
  {
    id: 'visa-02',
    tier: 'VISA PLATINUM GOLD',
    last4: '3109',
    fullNumber: '4916 •••• •••• 3109',
    holder: 'VIRTUAL HOLDER',
    expiry: '08/29',
    cvv: '419',
    balanceLimit: '$1,500 USD',
    durationOptions: [
      { id: '24h', label: '24 Horas', price: 25 },
      { id: '7d', label: '7 Días', price: 60 },
      { id: '30d', label: '30 Días', price: 140 }
    ],
    theme: 'gold',
    available: true
  },
  {
    id: 'visa-03',
    tier: 'VISA SIGNATURE CYBER',
    last4: '7741',
    fullNumber: '4024 •••• •••• 7741',
    holder: 'VIRTUAL HOLDER',
    expiry: '04/28',
    cvv: '902',
    balanceLimit: '$250 USD',
    durationOptions: [
      { id: '24h', label: '24 Horas', price: 10 },
      { id: '7d', label: '7 Días', price: 22 },
      { id: '30d', label: '30 Días', price: 50 }
    ],
    theme: 'cyber',
    available: true
  }
];

// Alquileres activos en memoria
const activeRentals = [];

// Ruta de salud para Render
app.get('/', (req, res) => {
  res.json({ status: 'OK', service: 'Visa 3D Rental API' });
});

// Obtener tarjetas disponibles
app.get('/api/cards', (req, res) => {
  res.json(visaCards.filter(c => c.available));
});

// Procesar solicitud de alquiler
app.post('/api/rent', (req, res) => {
  const { cardId, durationId, telegramUser } = req.body;
  
  const card = visaCards.find(c => c.id === cardId);
  if (!card || !card.available) {
    return res.status(400).json({ error: 'Tarjeta no disponible' });
  }

  const plan = card.durationOptions.find(d => d.id === durationId);
  if (!plan) {
    return res.status(400).json({ error: 'Plan de vigencia inválido' });
  }

  // Calcular expiración
  const hours = durationId === '24h' ? 24 : durationId === '7d' ? 168 : 720;
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();

  const rentalRecord = {
    rentalId: 'RNT-' + Math.floor(100000 + Math.random() * 900000),
    user: telegramUser || 'Usuario Telegram',
    cardId: card.id,
    tier: card.tier,
    plan: plan.label,
    price: plan.price,
    expiresAt,
    // Datos revelados tras confirmar
    cardDetails: {
      number: card.fullNumber.replace('•••• ••••', '7521 9043'),
      expiry: card.expiry,
      cvv: card.cvv
    }
  };

  activeRentals.push(rentalRecord);

  res.json({
    success: true,
    message: 'Tarjeta Visa asignada correctamente',
    rental: rentalRecord
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
