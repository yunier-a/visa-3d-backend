const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================================
// CONEXIÓN A BASE DE DATOS (MONGODB ATLAS)
// Configura MONGODB_URI en Render -> Environment
// ============================================================================
const MONGODB_URI = process.env.MONGODB_URI || '';
let dbConnected = false;

const rentalSchema = new mongoose.Schema({
  rentalId: { type: String, required: true, unique: true },
  provider: { type: String, default: 'cardon.one' },
  providerCardId: { type: String, required: true },
  mode: { type: String, default: 'SANDBOX_FALLBACK' },
  telegramUserId: { type: String, required: true, index: true },
  telegramName: { type: String, default: 'Usuario Telegram' },
  tier: { type: String, required: true },
  shortName: { type: String, required: true },
  theme: { type: String, required: true },
  balanceLimit: { type: String, required: true },
  durationLabel: { type: String, required: true },
  price: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ['ACTIVE', 'EXPIRED'], default: 'ACTIVE', index: true },
  cardDetails: {
    number: { type: String, required: true },
    expiry: { type: String, required: true },
    cvv: { type: String, required: true }
  }
});

const Rental = mongoose.model('Rental', rentalSchema);
const memoryRentals = [];

async function connectDatabase() {
  if (!MONGODB_URI) {
    console.warn('[DB] MONGODB_URI no configurada; usando respaldo temporal en memoria.');
    return;
  }
  try {
    await mongoose.connect(MONGODB_URI);
    dbConnected = true;
    console.log('[DB] Conectado a MongoDB Atlas correctamente.');
  } catch (err) {
    console.error('[DB] Error conectando a MongoDB Atlas:', err.message);
  }
}

// Helpers de acceso a datos (DB si está conectada, memoria si aún no configuraste URI)
async function saveRental(record) {
  if (dbConnected) {
    const doc = await Rental.create(record);
    return doc.toObject();
  }
  memoryRentals.push(record);
  return record;
}

async function getRentalsByUser(telegramUserId) {
  if (dbConnected) {
    return Rental.find({ telegramUserId: String(telegramUserId) })
      .sort({ createdAt: -1 })
      .lean();
  }
  return memoryRentals
    .filter(r => String(r.telegramUserId) === String(telegramUserId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getExpiredActiveRentals(nowDate) {
  if (dbConnected) {
    return Rental.find({ status: 'ACTIVE', expiresAt: { $lte: nowDate } }).lean();
  }
  return memoryRentals.filter(
    r => r.status === 'ACTIVE' && new Date(r.expiresAt).getTime() <= nowDate.getTime()
  );
}

async function markRentalExpired(rentalId) {
  if (dbConnected) {
    await Rental.updateOne({ rentalId }, { $set: { status: 'EXPIRED' } });
    return;
  }
  const found = memoryRentals.find(r => r.rentalId === rentalId);
  if (found) found.status = 'EXPIRED';
}

// ============================================================================
// CONECTOR PROVEEDOR: cardon.one (SOLO TARJETAS VISA)
// ============================================================================
const cardonOneProvider = {
  getConfig() {
    return {
      baseUrl: (process.env.CARDON_BASE_URL || '').replace(/\/+$/, ''),
      apiKey: process.env.CARDON_API_KEY || '',
      issuePath: process.env.CARDON_ISSUE_PATH || '/cards/issue',
      freezePath: process.env.CARDON_FREEZE_PATH || '/cards/{id}/freeze'
    };
  },

  async issueVisaCard({ tier, balanceLimit, durationId, hours, telegramUserId }) {
    const cfg = this.getConfig();

    if (!cfg.baseUrl || !cfg.apiKey) {
      const rand4 = () => Math.floor(1000 + Math.random() * 9000);
      const rand3 = () => Math.floor(100 + Math.random() * 900);
      return {
        provider: 'cardon.one',
        providerCardId: `cdn_${Date.now()}_${rand3()}`,
        pan: `4532 ${rand4()} ${rand4()} ${rand4()}`,
        expiry: '12/29',
        cvv: String(rand3()),
        status: 'ACTIVE',
        mode: 'SANDBOX_FALLBACK'
      };
    }

    const endpoint = `${cfg.baseUrl}${cfg.issuePath.startsWith('/') ? '' : '/'}${cfg.issuePath}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
        'X-API-Key': cfg.apiKey
      },
      body: JSON.stringify({
        provider: 'cardon.one',
        brand: 'VISA',
        tier,
        limit: balanceLimit,
        duration: durationId,
        duration_hours: hours,
        external_user_id: String(telegramUserId)
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`cardon.one issue error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const cardObj = data.data || data.card || data;

    return {
      provider: 'cardon.one',
      providerCardId: String(cardObj.id || cardObj.card_id || `cdn_${Date.now()}`),
      pan: String(cardObj.pan || cardObj.number || cardObj.card_number || ''),
      expiry: String(cardObj.expiry || cardObj.exp_date || ''),
      cvv: String(cardObj.cvv || cardObj.cvc || ''),
      status: 'ACTIVE',
      mode: 'LIVE_CARDON_ONE'
    };
  },

  async freezeVisaCard(providerCardId) {
    const cfg = this.getConfig();

    if (!cfg.baseUrl || !cfg.apiKey) {
      console.log(`[cardon.one SANDBOX] Tarjeta VISA ${providerCardId} congelada por vencimiento.`);
      return true;
    }

    const resolvedPath = cfg.freezePath.replace('{id}', encodeURIComponent(providerCardId));
    const endpoint = `${cfg.baseUrl}${resolvedPath.startsWith('/') ? '' : '/'}${resolvedPath}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
        'X-API-Key': cfg.apiKey
      },
      body: JSON.stringify({
        card_id: providerCardId,
        status: 'FROZEN',
        reason: 'RENTAL_EXPIRED'
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`cardon.one freeze error (${response.status}): ${errText}`);
    }

    return true;
  }
};

// Catálogo exclusivo de tarjetas VISA
const visaPlans = [
  {
    id: 'visa-01',
    tier: 'VISA INFINITE BLACK',
    shortName: 'BLACK',
    balanceLimit: '$500 USD',
    theme: 'obsidian',
    durationOptions: [
      { id: '24h', label: '24 Horas', hours: 24, price: 15 },
      { id: '7d', label: '7 Días', hours: 168, price: 35 },
      { id: '30d', label: '30 Días', hours: 720, price: 80 }
    ]
  },
  {
    id: 'visa-02',
    tier: 'VISA PLATINUM GOLD',
    shortName: 'GOLD',
    balanceLimit: '$1,500 USD',
    theme: 'gold',
    durationOptions: [
      { id: '24h', label: '24 Horas', hours: 24, price: 25 },
      { id: '7d', label: '7 Días', hours: 168, price: 60 },
      { id: '30d', label: '30 Días', hours: 720, price: 140 }
    ]
  },
  {
    id: 'visa-03',
    tier: 'VISA SIGNATURE CYBER',
    shortName: 'CYBER',
    balanceLimit: '$250 USD',
    theme: 'cyber',
    durationOptions: [
      { id: '24h', label: '24 Horas', hours: 24, price: 10 },
      { id: '7d', label: '7 Días', hours: 168, price: 22 },
      { id: '30d', label: '30 Días', hours: 720, price: 50 }
    ]
  }
];

app.get('/', (req, res) => {
  const cfg = cardonOneProvider.getConfig();
  res.json({
    status: 'OK',
    provider: 'cardon.one',
    brand: 'VISA',
    databaseConnected: dbConnected,
    liveApiConfigured: Boolean(cfg.baseUrl && cfg.apiKey)
  });
});

app.get('/api/plans', (req, res) => {
  res.json(visaPlans);
});

app.get('/api/my-cards/:telegramUserId', async (req, res) => {
  try {
    const list = await getRentalsByUser(req.params.telegramUserId);
    res.json(list);
  } catch (err) {
    console.error('Error leyendo alquileres:', err);
    res.status(500).json({ error: 'Error al consultar las tarjetas' });
  }
});

app.post('/api/rent', async (req, res) => {
  try {
    const { cardId, durationId, telegramUserId, telegramName } = req.body;

    const planGroup = visaPlans.find(p => p.id === cardId);
    if (!planGroup) {
      return res.status(400).json({ error: 'Plan de tarjeta VISA no válido' });
    }

    const duration = planGroup.durationOptions.find(d => d.id === durationId);
    if (!duration) {
      return res.status(400).json({ error: 'Tiempo de vigencia no válido' });
    }

    const issued = await cardonOneProvider.issueVisaCard({
      tier: planGroup.tier,
      balanceLimit: planGroup.balanceLimit,
      durationId: duration.id,
      hours: duration.hours,
      telegramUserId: telegramUserId || 'guest'
    });

    const nowMs = Date.now();
    const expiresAt = new Date(nowMs + duration.hours * 3600 * 1000);

    const record = {
      rentalId: 'CDN-' + Math.floor(100000 + Math.random() * 900000),
      provider: 'cardon.one',
      providerCardId: issued.providerCardId,
      mode: issued.mode,
      telegramUserId: String(telegramUserId || 'guest'),
      telegramName: telegramName || 'Usuario Telegram',
      tier: planGroup.tier,
      shortName: planGroup.shortName,
      theme: planGroup.theme,
      balanceLimit: planGroup.balanceLimit,
      durationLabel: duration.label,
      price: duration.price,
      createdAt: new Date(nowMs),
      expiresAt,
      status: 'ACTIVE',
      cardDetails: {
        number: issued.pan,
        expiry: issued.expiry,
        cvv: issued.cvv
      }
    };

    const saved = await saveRental(record);

    res.json({
      success: true,
      rental: saved
    });
  } catch (error) {
    console.error('Error al emitir tarjeta en cardon.one:', error);
    res.status(502).json({ error: 'Error al emitir la tarjeta VISA con cardon.one' });
  }
});

// Revisor automático cada 30 segundos para expirar/congelar tarjetas VISA vencidas
setInterval(async () => {
  try {
    const nowDate = new Date();
    const expiredList = await getExpiredActiveRentals(nowDate);
    for (const item of expiredList) {
      await markRentalExpired(item.rentalId);
      try {
        await cardonOneProvider.freezeVisaCard(item.providerCardId);
      } catch (err) {
        console.error(`Error congelando tarjeta ${item.providerCardId}:`, err);
      }
    }
  } catch (err) {
    console.error('Error en tarea de expiración:', err);
  }
}, 30000);

const PORT = process.env.PORT || 3000;
connectDatabase().finally(() => {
  app.listen(PORT, () => {
    console.log(`Servidor VISA 3D escuchando en puerto ${PORT}`);
  });
});