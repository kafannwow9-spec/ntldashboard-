const express = require('express');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables as a fallback
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Enable CORS middleware for Cloudflare Pages cross-domain access
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve uploaded assets on port 3000
const uploadsPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}
app.use('/uploads', express.static(uploadsPath));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Path to the config file
const configPath = path.join(__dirname, 'config.json');

// Helper function to read config
function getMergedConfig() {
  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      const fileData = fs.readFileSync(configPath, 'utf8');
      fileConfig = JSON.parse(fileData);
    } catch (err) {
      console.error("❌ Error reading or parsing config.json:", err);
    }
  }

  // Fallback chain: config.json -> process.env -> default empty
  const CLIENT_ID = fileConfig.CLIENT_ID || process.env.CLIENT_ID || "";
  const CLIENT_SECRET = fileConfig.CLIENT_SECRET || process.env.CLIENT_SECRET || "";
  const BOT_TOKEN = fileConfig.BOT_TOKEN || process.env.BOT_TOKEN || "";
  const BOT_IP_PORT = fileConfig.BOT_IP_PORT || process.env.BOT_IP_PORT || "";
  const BOT_SECRET = fileConfig.BOT_SECRET || process.env.BOT_SECRET || "";
  
  // Resolve App URL for Redirect URI construction
  const rawAppUrl = process.env.APP_URL || "";
  const cleanAppUrl = rawAppUrl.endsWith('/') ? rawAppUrl.slice(0, -1) : rawAppUrl;
  
  const REDIRECT_URI = fileConfig.REDIRECT_URI || process.env.REDIRECT_URI || (cleanAppUrl ? `${cleanAppUrl}/auth/callback` : "http://localhost:3000/auth/callback");

  return {
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI,
    BOT_TOKEN,
    BOT_IP_PORT,
    BOT_SECRET,
    guilds: fileConfig.guilds || {}
  };
}

// 1. API: Get configuration status and credentials presence
app.get('/api/config-status', (req, res) => {
  const cfg = getMergedConfig();
  res.json({
    clientConfigured: !!cfg.CLIENT_ID,
    secretConfigured: !!cfg.CLIENT_SECRET,
    botConfigured: !!cfg.BOT_TOKEN,
    redirectUri: cfg.REDIRECT_URI,
    clientId: cfg.CLIENT_ID ? `***...${cfg.CLIENT_ID.slice(-4)}` : null
  });
});

// 2. API: Redirect to Discord Authorization Portal
app.get('/api/auth/login', (req, res) => {
  const cfg = getMergedConfig();
  if (!cfg.CLIENT_ID || !cfg.REDIRECT_URI) {
    return res.status(400).send(`
      <html>
        <body style="background: #0a0f1d; color: #f3f4f6; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; padding: 20px; direction: rtl;">
          <div style="background: #1e1b4b; border: 1px solid #3730a3; padding: 30px; border-radius: 12px; max-width: 450px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.3);">
            <h2 style="color: #f87171; margin-bottom: 12px; font-size: 22px;">⚠️ إعدادات غير مكتملة</h2>
            <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
              لم يتم تهيئة معرف البوت (CLIENT_ID) أو رابط التوجيه (REDIRECT_URI) بشكل صحيح.
              يرجى إضافتهم أولاً في ملف <strong>config.json</strong> أو عبر لوحة Secrets.
            </p>
            <button onclick="window.close()" style="background: #ef4444; hover:background: #dc2626; color: white; border: none; padding: 10px 24px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s;">إغلاق النافذة</button>
          </div>
        </body>
      </html>
    `);
  }

  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${cfg.CLIENT_ID}&redirect_uri=${encodeURIComponent(cfg.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
  res.redirect(discordAuthUrl);
});

// 3. API: OAuth2 Callback Route
app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
  const { code } = req.query;
  const cfg = getMergedConfig();

  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  try {
    // Exchange Authorization Code for Token
    const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: cfg.CLIENT_ID,
        client_secret: cfg.CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: cfg.REDIRECT_URI
      }).toString()
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      console.error("Token exchange failed:", errBody);
      throw new Error(`Failed to exchange code for token: ${tokenResponse.statusText}`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Fetch User Profile
    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!userRes.ok) throw new Error("Failed to fetch user profile");
    const user = await userRes.json();

    // Fetch User Guilds
    const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!guildsRes.ok) throw new Error("Failed to fetch user guilds");
    const guilds = await guildsRes.json();

    // Filter Admin Guilds (ADMINISTRATOR permission is 0x8)
    const adminGuilds = guilds.filter(g => {
      const perms = BigInt(g.permissions);
      return (perms & 8n) === 8n;
    });

    // Fetch Bot Guilds if BOT_TOKEN is present
    let botGuilds = [];
    if (cfg.BOT_TOKEN) {
      try {
        const botGuildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
          headers: { 'Authorization': `Bot ${cfg.BOT_TOKEN}` }
        });
        if (botGuildsRes.ok) {
          botGuilds = await botGuildsRes.json();
        }
      } catch (err) {
        console.error("⚠️ Error fetching bot guilds:", err);
      }
    }

    const botGuildIds = new Set(botGuilds.map(g => g.id));

    // Map guilds to return hasBot flag
    const mappedGuilds = adminGuilds.map(g => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      hasBot: botGuildIds.has(g.id)
    }));

    // Send successful message and data back to parent window using postMessage and close popup
    res.send(`
      <html>
        <body style="background: #0a0f1d; color: #f3f4f6; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center;">
          <div style="padding: 20px;">
            <div style="border: 4px solid #3b82f6; border-top-color: transparent; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; margin: 0 auto 20px;"></div>
            <h2 style="margin-bottom: 8px;">تم الاتصال بنجاح!</h2>
            <p style="color: #94a3b8; font-size: 14px;">جاري إغلاق هذه النافذة ومزامنة بيانات لوحة التحكم...</p>
          </div>
          <style>
            @keyframes spin { to { transform: rotate(360deg); } }
          </style>
          <script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'OAUTH_AUTH_SUCCESS',
                accessToken: '${accessToken}',
                user: ${JSON.stringify(user)},
                guilds: ${JSON.stringify(mappedGuilds)}
              }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("OAuth Error:", error);
    res.status(500).send(`
      <html>
        <body style="background: #0a0f1d; color: #f87171; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; direction: rtl;">
          <div style="max-width: 400px; padding: 20px;">
            <h2 style="margin-bottom: 12px;">❌ فشل المصادقة</h2>
            <p style="color: #cbd5e1; margin-bottom: 20px;">حدث خطأ أثناء تبادل الرموز مع ديسكورد. يرجى التحقق من صحة CLIENT_SECRET ورابط التحويل.</p>
            <button onclick="window.close()" style="background: #ef4444; color: white; border: none; padding: 8px 20px; border-radius: 5px; cursor: pointer;">إغلاق النافذة</button>
          </div>
        </body>
      </html>
    `);
  }
});

// 4. API: Get latest guilds from authorization token
app.get('/api/guilds', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }

  const accessToken = authHeader.split(' ')[1];
  const cfg = getMergedConfig();

  try {
    // Fetch user guilds
    const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!guildsRes.ok) throw new Error("Failed to fetch user guilds from Discord");
    const guilds = await guildsRes.json();

    // Filter Admin Guilds
    const adminGuilds = guilds.filter(g => {
      const perms = BigInt(g.permissions);
      return (perms & 8n) === 8n;
    });

    // Fetch Bot Guilds
    let botGuilds = [];
    if (cfg.BOT_TOKEN) {
      try {
        const botGuildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
          headers: { 'Authorization': `Bot ${cfg.BOT_TOKEN}` }
        });
        if (botGuildsRes.ok) {
          botGuilds = await botGuildsRes.json();
        }
      } catch (err) {
        console.error("⚠️ Error fetching bot guilds inside API:", err);
      }
    }

    const botGuildIds = new Set(botGuilds.map(g => g.id));

    const mappedGuilds = adminGuilds.map(g => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      hasBot: botGuildIds.has(g.id)
    }));

    res.json({ success: true, guilds: mappedGuilds });
  } catch (error) {
    console.error("Error fetching guilds:", error);
    res.status(500).json({ error: "Failed to fetch guilds from Discord" });
  }
});

// 5. API: Save Commands Settings for a specific Guild
app.post('/api/save-commands', (req, res) => {
  const { guildId, commands } = req.body;
  if (!guildId || !commands) {
    return res.status(400).json({ error: "Missing guildId or commands object" });
  }

  // Load current config to avoid overwriting other keys
  let fileConfig = { guilds: {} };
  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.error("Error parsing config:", err);
    }
  }

  if (!fileConfig.guilds) {
    fileConfig.guilds = {};
  }

  // Update commands for this guild
  fileConfig.guilds[guildId] = commands;

  try {
    fs.writeFileSync(configPath, JSON.stringify(fileConfig, null, 2), 'utf8');
    res.json({ success: true, message: "تم حفظ إعدادات الأوامر بنجاح!" });
  } catch (err) {
    console.error("Failed to write to config.json:", err);
    res.status(500).json({ error: "Failed to write configuration to disk" });
  }
});

// Helper functions to read and write tickets_db.json
const ticketsDbPath = path.join(__dirname, 'tickets_db.json');

function getTicketsDB() {
  if (fs.existsSync(ticketsDbPath)) {
    try {
      return JSON.parse(fs.readFileSync(ticketsDbPath, 'utf8'));
    } catch (err) {
      console.error("Error reading tickets_db.json:", err);
    }
  }
  return {};
}

function saveTicketsDB(data) {
  try {
    fs.writeFileSync(ticketsDbPath, JSON.stringify(data, null, 4), 'utf8');
    return true;
  } catch (err) {
    console.error("Error saving tickets_db.json:", err);
    return false;
  }
}

// 6. API: Get commands settings for a specific Guild (Integrated with tickets_db.json & Discord live info)
app.get('/api/guild-settings/:guildId', async (req, res) => {
  const { guildId } = req.params;
  const db = getTicketsDB();
  const guildData = db[guildId] || {};

  const panels = guildData.panels || {};
  const suggestions = guildData.suggestions || {};
  const azkar = guildData.azkar || {};
  const musicEnabled = guildData.musicEnabled !== undefined ? guildData.musicEnabled : false;
  const deltaKeys = guildData.deltaKeys || {};
  const protection = guildData.protection || {
    permissions: { enabled: false, punishment: 'kick', punishmentDuration: '' },
    roles: { enabled: false, punishment: 'kick', punishmentDuration: '' },
    channels: { enabled: false, punishment: 'kick', punishmentDuration: '' },
    bots: { enabled: false, punishment: 'ban', punishmentDuration: '' },
    links: { enabled: false, punishment: 'timeout', punishmentDuration: '1h' },
    spam: { enabled: false, punishment: 'timeout', punishmentDuration: '10m' }
  };

  let channels = [];
  let categories = [];
  let roles = [];

  const client = global.discordClient;
  if (client && client.isReady()) {
    try {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (guild) {
        channels = guild.channels.cache
          .filter(c => c.type === 0 || c.type === 'GUILD_TEXT')
          .map(c => ({ id: c.id, name: c.name }));
        categories = guild.channels.cache
          .filter(c => c.type === 4 || c.type === 'GUILD_CATEGORY')
          .map(c => ({ id: c.id, name: c.name }));
        roles = guild.roles.cache
          .filter(r => r.name !== '@everyone')
          .map(r => ({ id: r.id, name: r.name }));
      }
    } catch (err) {
      console.error("Error fetching live guild info:", err);
    }
  }

  res.json({
    success: true,
    settings: {
      panels,
      suggestions,
      azkar,
      protection,
      musicEnabled,
      deltaKeys
    },
    channels,
    categories,
    roles
  });
});

// 7. API: Save all settings for a specific Guild
app.post('/api/save-guild-settings/:guildId', async (req, res) => {
  const { guildId } = req.params;
  const { panels, suggestions, azkar, protection, musicEnabled, deltaKeys } = req.body;

  const db = getTicketsDB();
  if (!db[guildId]) {
    db[guildId] = { panels: {}, tickets: {}, counter: 0 };
  }

  if (panels !== undefined) db[guildId].panels = panels;
  if (suggestions !== undefined) db[guildId].suggestions = suggestions;
  if (azkar !== undefined) db[guildId].azkar = azkar;
  if (protection !== undefined) db[guildId].protection = protection;
  if (musicEnabled !== undefined) db[guildId].musicEnabled = musicEnabled;
  if (deltaKeys !== undefined) db[guildId].deltaKeys = deltaKeys;

  const saved = saveTicketsDB(db);
  if (saved) {
    if (global.reloadAzkar) {
      try {
        global.reloadAzkar(guildId);
      } catch (err) {
        console.error("Error reloading azkar scheduler:", err);
      }
    }

    // Forward settings to the bot API
    const cfg = getMergedConfig();
    let botUpdated = false;
    let botErrorMsg = "";
    
    const isSameProcess = !!global.reloadAzkar;
    const isLocalHost = cfg.BOT_IP_PORT && (cfg.BOT_IP_PORT.includes('localhost') || cfg.BOT_IP_PORT.includes('127.0.0.1'));

    if (isSameProcess && (!cfg.BOT_IP_PORT || isLocalHost)) {
      botUpdated = true;
      console.log(`Bot settings updated instantly in-memory for guild ${guildId} (Same Process)`);
    } else if (cfg.BOT_IP_PORT && cfg.BOT_SECRET) {
      try {
        let botUrl = cfg.BOT_IP_PORT;
        if (!botUrl.startsWith('http://') && !botUrl.startsWith('https://')) {
          botUrl = `http://${botUrl}`;
        }
        botUrl = botUrl.replace(/\/$/, '') + '/update-settings';

        console.log(`Sending settings update to Bot API: ${botUrl}`);
        const botRes = await fetch(botUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Bot-Secret': cfg.BOT_SECRET
          },
          body: JSON.stringify({
            guildId,
            panels,
            suggestions,
            azkar,
            protection,
            musicEnabled,
            deltaKeys
          }),
          signal: AbortSignal.timeout(5000) // Timeout after 5 seconds to avoid hanging
        });

        if (botRes.ok) {
          botUpdated = true;
          console.log(`Bot settings updated successfully via API for guild ${guildId}`);
        } else {
          const errMsg = await botRes.text();
          botErrorMsg = `Bot responded with status: ${botRes.status} - ${errMsg}`;
          console.error(`Failed to update bot settings: ${botErrorMsg}`);
        }
      } catch (err) {
        botErrorMsg = err.message;
        console.error("Error contacting Discord Bot API:", err);
      }
    }

    res.json({ 
      success: true, 
      message: botUpdated 
        ? "تم حفظ الإعدادات بنجاح ومزامنتها وتحديث البوت فورياً!" 
        : (botErrorMsg ? `تم حفظ الإعدادات محلياً، ولكن فشل تحديث البوت تلقائياً: ${botErrorMsg}` : "تم حفظ الإعدادات بنجاح ومزامنتها مع البوت!")
    });
  } else {
    res.status(500).json({ error: "فشل حفظ التعديلات في ملف قاعدة البيانات." });
  }
});

// Serve frontend files
// We first check if the 'dist' directory exists (production static build), otherwise serve from root (development)
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(path.join(distPath, 'index.html'))) {
  app.use(express.static(distPath));
} else {
  app.use(express.static(__dirname));
}

// Fallback all other routes to index.html
app.get('*', (req, res) => {
  const distIndex = path.join(distPath, 'index.html');
  if (fs.existsSync(distIndex)) {
    res.sendFile(distIndex);
  } else {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

// Start listening
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✨ NTL Dashboard Server is fully active on port ${PORT}`);
  
  // Start the Discord Bot in the same process
  try {
    console.log("🤖 Starting NTL Discord Bot in parallel...");
    require('./index.js');
  } catch (err) {
    console.error("❌ Failed to start NTL Discord Bot:", err);
  }
});
