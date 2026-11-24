const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================================
// ADAPTADOR API EMISORA VISA (OPCIÓN B)
// Reemplaza estas llamadas con la API real de tu proveedor (Wallester, PST, etc.)
// usando variables de entorno en Render: VISA_API_URL y VISA_API_KEY
// ============================================================================
const visaIssuerProvider = {
  async issueCard({ tier, balanceLimit, durationId, telegramUserId }) {
    const apiUrl = process.env.VISA_API_URL;
    const apiKey = process.env.VISA_API_KEY;

    // Si aún no configuras las credenciales reales en Render, usa modo simulación segura
    if (!apiUrl || !apiKey) {
      const rand4 = () => Math.floor(1000 + Math.random() * 9000);
      const rand3 = () => Math.floor(100 + Math.random() * 900);
      return {
        providerCardId: `prov_${Date.now()}_${rand3()}`,
        pan: `4532 ${rand4()} ${rand4()} ${rand4()}`,
        expiry: '12/29',
        cvv: String(rand3()),
        status: 'ACTIVE',
        mode: 'SANDBOX_FALLBACK'
      };
    }

    // Llamada real a tu API emisora Visa
    const response = await fetch(`${apiUrl}/cards/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        brand: 'VISA',
        tier,
        limit: balanceLimit,
        duration: durationId,
        referenceUser: String(telegramUserId)
      })
    });

    if (!response.ok) {
      throw new Error(`Error de API emisora: ${response.status}`);
    }

    const data = await response.json();
    return {
      providerCardId: data.id || data.card_id,
      pan: data.pan || data.number,
      expiry: data.expiry,
      cvv: data.cvv,
      status: 'ACTIVE',
      mode: 'LIVE_API'
    };
  },

  async expireOrFreezeCard(providerCardId) {
    const apiUrl = process.env.VISA_API_URL;
    const apiKey = process.env.VISA_API_KEY;

    if (!apiUrl || !apiKey) {
      console.log(`[SIMULACIÓN] Tarjeta ${providerCardId} congelada/cancelada por vencimiento.`);
      return true;
    }

    const response = await fetch(`${apiUrl}/cards/${providerCardId}/freeze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });

    return response.ok;
  }
};

// Catálogo de planes Visa disponibles (solo VISA)
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

// Alquileres en memoria (listo para migrar a base de datos en el siguiente paso)
const rentals = [];

app.get('/', (req, res) => {
  res.json({ status: 'OK', service: 'Visa 3D Rental API - Option B (Issuer API)' });
});

app.get('/api/plans', (req, res) => {
  res.json(visaPlans);
});

// Obtener tarjetas alquiladas por usuario de Telegram
app.get('/api/my-cards/:telegramUserId', (req, res) => {
  const { telegramUserId } = req.params;
  const userRentals = rentals
    .filter(r => String(r.telegramUserId) === String(telegramUserId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(userRentals);
});

// Emitir y alquilar tarjeta Visa por tiempo definido vía API
app.post('/api/rent', async (req, res) => {
  try {
    const { cardId, durationId, telegramUserId, telegramName } = req.body;

    const planGroup = visaPlans.find(p => p.id === cardId);
    if (!planGroup) {
      return res.status(400).json({ error: 'Plan de tarjeta Visa no válido' });
    }

    const duration = planGroup.durationOptions.find(d => d.id === durationId);
    if (!duration) {
      return res.status(400).json({ error: 'Tiempo de vigencia no válido' });
    }

    const issued = await visaIssuerProvider.issueCard({
      tier: planGroup.tier,
      balanceLimit: planGroup.balanceLimit,
      durationId: duration.id,
      telegramUserId: telegramUserId || 'guest'
    });

    const now = Date.now();
    const expiresAt = new Date(now + duration.hours * 3600 * 1000).toISOString();

    const record = {
      rentalId: 'VISA-' + Math.floor(100000 + Math.random() * 900000),
      providerCardId: issued.providerCardId,
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
      status: 'ACTIVE', // ACTIVE | EXPIRED
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
    console.error('Error emitiendo tarjeta Visa:', error);
    res.status(502).json({ error: 'No se pudo emitir la tarjeta con la API externa' });
  }
});

// Revisor automático cada 30 segundos para expirar/congelar tarjetas vencidas en la API
setInterval(async () => {
  const now = Date.now();
  for (const item of rentals) {
    if (item.status === 'ACTIVE' && new Date(item.expiresAt).getTime() <= now) {
      item.status = 'EXPIRED';
      try {
        await visaIssuerProvider.expireOrFreezeCard(item.providerCardId);
      } catch (err) {
        console.error(`Error congelando tarjeta ${item.providerCardId}:`, err);
      }
    }
  }
}, 30000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend Opción B activo en puerto ${PORT}`);
});
