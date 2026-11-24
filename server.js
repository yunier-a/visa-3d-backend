const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================================
// CONECTOR PROVEEDOR: cardon.one (SOLO TARJETAS VISA)
// Configura estas variables en Render -> Environment:
// - CARDON_BASE_URL   (ej. https://api.cardon.one/v1)
// - CARDON_API_KEY    (tu API Key o Token de cardon.one)
// - CARDON_ISSUE_PATH (opcional, por defecto: /cards/issue)
// - CARDON_FREEZE_PATH(opcional, por defecto: /cards/{id}/freeze)
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

    // Si aún no configuras CARDON_BASE_URL o CARDON_API_KEY en Render, opera en modo sandbox
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
      console.log(`[cardon.one SANDBOX] Tarjeta VISA ${providerCardId} congelada al vencer el plazo.`);
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

const rentals = [];

app.get('/', (req, res) => {
  const cfg = cardonOneProvider.getConfig();
  res.json({
    status: 'OK',
    provider: 'cardon.one',
    brand: 'VISA',
    liveApiConfigured: Boolean(cfg.baseUrl && cfg.apiKey)
  });
});

app.get('/api/plans', (req, res) => {
  res.json(visaPlans);
});

app.get('/api/my-cards/:telegramUserId', (req, res) => {
  const { telegramUserId } = req.params;
  const userRentals = rentals
    .filter(r => String(r.telegramUserId) === String(telegramUserId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(userRentals);
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

    const now = Date.now();
    const expiresAt = new Date(now + duration.hours * 3600 * 1000).toISOString();

    const record = {
      rentalId: 'CDN-' + Math.floor(100000 + Math.random() * 900000),
      provider: 'cardon.one',
      providerCardId: issued.providerCardId,
      mode: issued.mode,
      telegramUserId: telegramUserId || 'guest',
      telegramName: telegramName || 'Usuario Telegram',
      tier: planGroup.tier,
      shortName: planGroup.shortName,
      theme: planGroup.theme,
      balanceLimit: planGroup.balanceLimit,
      durationLabel: duration.label,
      price: duration.price,
      createdAt: new Date(now).toISOString(),
      expiresAt,
      status: 'ACTIVE',
      cardDetails: {
        number: issued.pan,
        expiry: issued.expiry,
        cvv: issued.cvv
      }
    };

    rentals.push(record);

    res.json({
      success: true,
      rental: record
    });
  } catch (error) {
    console.error('Error al emitir tarjeta en cardon.one:', error);
    res.status(502).json({ error: 'Error al emitir la tarjeta VISA con cardon.one' });
  }
});

// Verificación automática cada 30 segundos para congelar tarjetas VISA vencidas en cardon.one
setInterval(async () => {
  const now = Date.now();
  for (const item of rentals) {
    if (item.status === 'ACTIVE' && new Date(item.expiresAt).getTime() <= now) {
      item.status = 'EXPIRED';
      try {
        await cardonOneProvider.freezeVisaCard(item.providerCardId);
      } catch (err) {
        console.error(`Error congelando tarjeta ${item.providerCardId} en cardon.one:`, err);
      }
    }
  }
}, 30000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor VISA 3D (cardon.one) escuchando en puerto ${PORT}`);
});
