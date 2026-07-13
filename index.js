const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes, ChannelSelectMenuBuilder, ChannelType, UserSelectMenuBuilder, RoleSelectMenuBuilder, PermissionFlagsBits, AttachmentBuilder, MessageFlags, ActivityType } = require('discord.js');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

// استيراد نظام الأغاني المنفصل
const { initMusicSystem, makePlayerEmbedAndButtons, getKazagumo, guildPlayers, ContainerBuilder } = require('./music.js');

const playSearchCache = new Map();

// ضع التوكن الأساسي الخاص ببوتك ومفاتيح الذكاء الاصطناعي هنا
let BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    try {
        const configPath = path.join(process.cwd(), 'config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            BOT_TOKEN = config.BOT_TOKEN;
        }
    } catch (err) {
        console.error("Error reading BOT_TOKEN from config.json:", err);
    }
}
let BOT_SECRET = process.env.BOT_SECRET;
if (!BOT_SECRET) {
    try {
        const configPath = path.join(process.cwd(), 'config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            BOT_SECRET = config.BOT_SECRET;
        }
    } catch (err) {
        console.error("Error reading BOT_SECRET from config.json:", err);
    }
}
let GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY || GEMINI_API_KEY === "MY_GEMINI_API_KEY" || GEMINI_API_KEY === "ضع_مفتاح_جيميني_هنا") {
    GEMINI_API_KEY = "AQ.Ab8RN6KVozdbkJNadA1PQhJIQDw4RG2dtFbL0QJ_lE1B7T3uSQ";
}
const CLOUDFLARE_ACCOUNT_ID = "4dcafd8dea7635f5c2b537f3ea08d0c8";
const CLOUDFLARE_API_TOKEN = "cfut_FjjN0KMnUPXzcpWkf9Pev5OWiOHE5R0LJOCRntU9660a673b";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

global.discordClient = client;

const dbPath = './tickets_db.json';
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({}));

function getDB() { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); }
function saveDB(data) { fs.writeFileSync(dbPath, JSON.stringify(data, null, 4)); }

function isGuildPremium(guildId) {
    const database = getDB();
    if (!database[guildId]) return false;
    const premium = database[guildId].premium;
    if (!premium || !premium.expiresAt) return false;
    if (premium.expiresAt === 'lifetime') return true;
    return Date.now() < premium.expiresAt;
}

// HTTP server inside index.js to serve static avatar images and handle secure updates
const http = require('http');
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Bot-Secret');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
    }

    if (req.url.startsWith('/uploads/')) {
        const decodedUrl = decodeURIComponent(req.url);
        const safePath = path.normalize(decodedUrl).replace(/^(\.\.[\/\\])+/, '');
        const filePath = path.join(process.cwd(), safePath);
        
        // Ensure it stays inside uploads directory
        if (!filePath.startsWith(uploadsDir)) {
            res.statusCode = 403;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('Forbidden');
            return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.end('Not Found');
            } else {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'image/png');
                res.end(data);
            }
        });
    } else if (req.url === '/update-settings' && req.method === 'POST') {
        const reqSecret = req.headers['x-bot-secret'] || req.headers['X-Bot-Secret'];
        if (!BOT_SECRET || reqSecret !== BOT_SECRET) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Unauthorized: Invalid X-Bot-Secret' }));
            return;
        }

        let body = '';
        req.on('data', chunk => {
            body += chunk;
        });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const { guildId, panels, suggestions, azkar, protection, musicEnabled, deltaKeys } = payload;
                
                if (!guildId) {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify({ error: 'Missing guildId' }));
                    return;
                }

                // Update the db
                const db = getDB();
                if (!db[guildId]) {
                    db[guildId] = { panels: {}, tickets: {}, counter: 0 };
                }
                
                if (panels !== undefined) db[guildId].panels = panels;
                if (suggestions !== undefined) db[guildId].suggestions = suggestions;
                if (azkar !== undefined) db[guildId].azkar = azkar;
                if (protection !== undefined) db[guildId].protection = protection;
                if (musicEnabled !== undefined) db[guildId].musicEnabled = musicEnabled;
                if (deltaKeys !== undefined) db[guildId].deltaKeys = deltaKeys;

                saveDB(db);

                // Update system memory instantly
                if (global.reloadAzkar) {
                    try {
                        global.reloadAzkar(guildId);
                    } catch (err) {
                        console.error("Error reloading azkar scheduler inside bot:", err);
                    }
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ success: true, message: 'Settings updated and synchronized inside Bot successfully!' }));
            } catch (err) {
                console.error("Error parsing update-settings payload:", err);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: 'Internal Server Error', details: err.message }));
            }
        });
    } else {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Not Found');
    }
});

if (require.main === module) {
    console.log(`[BOT] Started directly via index.js. Redirecting to server.js to run both Express and Discord Bot in parallel.`);
    require('./server.js');
} else {
    console.log(`[BOT] Loaded inside Express process. Skipping independent HTTP server to avoid port collision.`);
}

const activeStates = new Map();
const activeClaims = new Set();
const azkarTimers = new Map();
const userMessageCache = new Map();
const bypassEvents = new Set();
const interactionCooldowns = new Map(); // للحد من العبث وضغط الأزرار العشوائي

const arabCountries = [
    { label: "المملكة العربية السعودية", value: "saudi", city: "Riyadh", country: "Saudi Arabia", method: 4, emoji: "🇸🇦" },
    { label: "جمهورية مصر العربية", value: "egypt", city: "Cairo", country: "Egypt", method: 5, emoji: "🇪🇬" },
    { label: "الإمارات العربية المتحدة", value: "uae", city: "Abu Dhabi", country: "United Arab Emirates", method: 16, emoji: "🇦🇪" },
    { label: "دولة قطر", value: "qatar", city: "Doha", country: "Qatar", method: 4, emoji: "🇶🇦" },
    { label: "دولة الكويت", value: "kuwait", city: "Kuwait City", country: "Kuwait", method: 9, emoji: "🇰🇼" },
    { label: "مملكة البحرين", value: "bahrain", city: "Manama", country: "Bahrain", method: 4, emoji: "🇧🇭" },
    { label: "سلطنة عمان", value: "oman", city: "Muscat", country: "Oman", method: 1, emoji: "🇴🇲" },
    { label: "المملكة الأردنية الهاشمية", value: "jordan", city: "Amman", country: "Jordan", method: 1, emoji: "🇯🇴" },
    { label: "فلسطين", value: "palestine", city: "Jerusalem", country: "Palestine", method: 1, emoji: "🇵🇸" },
    { label: "الجمهورية اللبنانية", value: "lebanon", city: "Beirut", country: "Lebanon", method: 1, emoji: "🇱🇧" },
    { label: "الجمهورية العربية السورية", value: "syria", city: "Damascus", country: "Syria", method: 1, emoji: "🇸🇾" },
    { label: "جمهورية العراق", value: "iraq", city: "Baghdad", country: "Iraq", method: 1, emoji: "🇮🇶" },
    { label: "الجمهورية اليمنية", value: "yemen", city: "Sanaa", country: "Yemen", method: 1, emoji: "🇾🇪" },
    { label: "الجمهورية الجزائرية", value: "algeria", city: "Algiers", country: "Algeria", method: 3, emoji: "🇩🇿" },
    { label: "المملكة المغربية", value: "morocco", city: "Rabat", country: "Morocco", method: 1, emoji: "🇲🇦" },
    { label: "الجمهورية التونسية", value: "tunisia", city: "Tunis", country: "Tunisia", method: 3, emoji: "🇹🇳" },
    { label: "دولة ليبيا", value: "libya", city: "Tripoli", country: "Libya", method: 3, emoji: "🇱🇾" },
    { label: "جمهورية السودان", value: "sudan", city: "Khartoum", country: "Sudan", method: 1, emoji: "🇸🇩" }
];

const mainAzkarList = [
    { title: "الدعاء عند سماع صياح الديك ونهيق الحمار", text: "إِذَا سَمِعْتُمْ صِيَاحَ الدِّيَكَةِ فَاسْأَلُوا اللَّهَ مِنْ فَضْلِهِ، فَإِنَّهَا رَأَتْ مَلَكًا، وَإِذَا سَمِعْتُمْ نَهِيقَ الْحِمَارِ فَتَعَوَّذُوا بِاللَّهِ مِنَ الشَّيْطَانِ، فَإِنَّهُ رَأَى شَيْطَانًا.", ref: "صحيح البخاري (٣٣٠٣)، صحيح مسلم (٢٧٢٩)" },
    { title: "الدعاء في السجود", text: "اللَّهُمَّ اغْفِرْ لِي ذَنْبِي كُلَّهُ، دِقَّهُ وَجِلَّهُ، وَأَوَّلَهُ وَآخِرَهُ، وَعَلانِيَتَهُ وَسِرَّهُ.", ref: "صحيح مسلم (٤٨٣)" },
    { title: "دعاء الكرب والهم", text: "لَا إِلَهَ إِلَّا اللَّهُمَّ الْعَظِيمُ الْحَلِيمُ، لَا إِلَهَ إِلَّا اللَّهُمَّ رَبُّ الْعَرْشِ الْعَظِيمِ، لَا إِلَهَ إِلَّا اللَّهُمَّ رَبُّ السَّمَاوَاتِ وَرَبُّ الْأَرْضِ وَرَبُّ الْعَرْشِ الْكَرِيمِ.", ref: "صحيح البخاري (٦٣٤٦)، صحيح مسلم (٢٧٣٠)" },
    { title: "الاستعاذة قبل التشهد", text: "اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنْ عَذَابِ جَهَنَّمَ، وَمِنْ عَذَابِ الْقَبْرِ، وَمِنْ فِتْنَةِ الْمَحْيَا وَالْمَمАТِ، وَمِنْ شَرِّ فِتْنَةِ الْمَسِيحِ الدَّجَّالِ.", ref: "صحيح مسلم (٥٨٨)" },
    { title: "دعاء الحماية اليومية", text: "بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ.", ref: "سنن أبي داود (٥٠٨٨)، سنن الترمذي (٣٣٨٨)" }
];

const shortDhikrs = [
    "أستغفر الله العظيم وأتوب إليه",
    "سبحان الله وبحمده، سبحان الله العظيم",
    "لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير",
    "اللهم صلِّ وسلم على نبينا محمد",
    "لا حول ولا قوة إلا بالله العلي العظيم",
    "الحمد لله حمداً كثيراً طيباً مباركاً فيه",
    "سبحان الله، والحمد لله، ولا إله إلا الله, والله أكبر",
    "يا حي يا قيوم برحمتك أستغيث أصلح لي شأني كله ولا تكلني إلى نفسي طرفة عين"
];

async function saveAttachmentPermanently(guild, attachment) {
    if (!attachment) return null;
    try {
        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        const ext = path.extname(attachment.name) || '.png';
        const cleanName = path.basename(attachment.name, ext).replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `${Date.now()}_${cleanName}${ext}`;
        const dest = path.join(uploadsDir, filename);

        const downloadWithRedirects = (downloadUrl, fileDest) => {
            return new Promise((resolve, reject) => {
                const options = {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                };
                https.get(downloadUrl, options, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        downloadWithRedirects(res.headers.location, fileDest).then(resolve).catch(reject);
                        return;
                    }
                    if (res.statusCode !== 200) {
                        reject(new Error(`Server returned status code ${res.statusCode}`));
                        return;
                    }
                    const file = fs.createWriteStream(fileDest);
                    res.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                    file.on('error', (err) => {
                        fs.unlink(fileDest, () => {});
                        reject(err);
                    });
                }).on('error', (err) => {
                    fs.unlink(fileDest, () => {});
                    reject(err);
                });
            });
        };
        
        await downloadWithRedirects(attachment.url, dest);

        const baseUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
        return `${baseUrl}/uploads/${filename}`;
    } catch (e) {
        console.error('Failed to save attachment locally:', e);
        return attachment.url; // fallback to original url if failed
    }
}

function ensureGuildData(guildId) {
    const db = getDB();
    if (!db[guildId]) db[guildId] = { panels: {}, tickets: {}, counter: 0 };
    if (!db[guildId].panels) db[guildId].panels = {};
    if (!db[guildId].tickets) db[guildId].tickets = {};
    if (db[guildId].counter === undefined) db[guildId].counter = 0;
    if (!db[guildId].protection) {
        db[guildId].protection = {
            permissions: { enabled: false, punishment: 'kick', punishmentDuration: '' },
            roles: { enabled: false, punishment: 'kick', punishmentDuration: '' },
            channels: { enabled: false, punishment: 'kick', punishmentDuration: '' },
            bots: { enabled: false, punishment: 'ban', punishmentDuration: '' },
            links: { enabled: false, punishment: 'timeout', punishmentDuration: '1h' },
            spam: { enabled: false, punishment: 'timeout', punishmentDuration: '10m' }
        };
    }
    if (!db[guildId].violations) db[guildId].violations = [];
    if (!db[guildId].suggestions) db[guildId].suggestions = {};
    if (db[guildId].musicEnabled === undefined) db[guildId].musicEnabled = false;
    if (!db[guildId].ai) {
        db[guildId].ai = {
            name: 'غير محدد',
            avatar: 'غير محدد',
            status: 'غير متصل',
            channelId: null,
            categoryId: null,
            trainingType: null,
            knowledge: [],
            autoTrainedData: ''
        };
    }
    saveDB(db);
    return db;
}

function toArabicDigits(num) {
    const id = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
    return num.toString().replace(/[0-9]/g, w => id[+w]);
}

function formatToArabicTime(timeStr) {
    let [hours, minutes] = timeStr.split(':');
    hours = parseInt(hours);
    const period = hours >= 12 ? 'م' : 'ص';
    hours = hours % 12 || 12;
    return `${toArabicDigits(hours)}:${toArabicDigits(minutes)} ${period}`;
}

function fetchPrayerTimings(city, country, method, targetUrl = null) {
    return new Promise((resolve, reject) => {
        let finalUrl = targetUrl || `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=${method}`;
        const urlObj = new URL(finalUrl);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        };
        https.get(options, res => {
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                let redirectUrl = res.headers.location;
                if (!redirectUrl.startsWith('http')) redirectUrl = 'https://api.aladhan.com' + redirectUrl;
                return fetchPrayerTimings(null, null, null, redirectUrl).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`API Error: ${res.statusCode}`));
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

function getPrayerCountryMenu() {
    const menu = new StringSelectMenuBuilder().setCustomId('select_prayer_country').setPlaceholder('اختر الدولة لعرض مواقيت الصلاة...');
    arabCountries.forEach(c => menu.addOptions({ label: c.label, value: c.value, emoji: c.emoji }));
    return new ActionRowBuilder().addComponents(menu);
}

async function generateAzkarCard(title, text, ref) {
    const width = 850, height = 360;
    const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#5f4268'); grad.addColorStop(1, '#3b203d');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(width/2, height/2, 190, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(width/2, height/2, 240, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; ctx.font = '14px Cairo';
    ctx.fillText('FD', 40, 55); ctx.fillText('FA', 40, 75); ctx.strokeRect(35, 38, 30, 45);
    ctx.fillText('FD', width-70, height-65); ctx.fillText('FB', width-70, height-45); ctx.strokeRect(width-75, height-82, 30, 45);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; ctx.font = '20px Cairo'; ctx.textAlign = 'center';
    ctx.fillText(title, width/2, 65);
    ctx.fillStyle = '#ffffff'; ctx.font = '22px Cairo';
    const words = text.split(' ');
    let line = '', lines = [], maxWidth = 720;
    for (let n = 0; n < words.length; n++) {
        let testLine = line + words[n] + ' ';
        if (ctx.measureText(testLine).width > maxWidth && n > 0) { lines.push(line); line = words[n] + ' '; }
        else line = testLine;
    }
    lines.push(line);
    const lh = 42;
    let startY = (height/2) - ((lines.length - 1)*lh/2) + 10;
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i].trim(), width/2, startY + (i*lh));
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'; ctx.font = '12px Cairo';
    ctx.fillText(`NTL BOT • أذكار وأدعية مأثورة • المرجع: ${ref}`, width/2, height-25);
    return canvas.toBuffer('image/png');
}

async function generatePrayerCard(timingsData, countryLabel) {
    const width = 850, height = 480;
    const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
    const timings = timingsData.data.timings, hijri = timingsData.data.date.hijri, gregorian = timingsData.data.date.gregorian;
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#100c1e'); grad.addColorStop(1, '#231631');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    [[100, 80, 1.5], [230, 40, 2], [320, 100, 1], [450, 50, 2.5], [540, 120, 1.5], [620, 70, 2], [780, 90, 1]].forEach(([x, y, r]) => {
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    });
    ctx.shadowBlur = 15; ctx.shadowColor = 'rgba(255, 215, 0, 0.4)'; ctx.fillStyle = '#ffd700';
    ctx.beginPath(); ctx.arc(710, 100, 32, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#100c1e';
    ctx.beginPath(); ctx.arc(696, 100, 32, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(12, 8, 22, 0.9)';
    ctx.beginPath(); ctx.moveTo(0, height); ctx.lineTo(0, height-30); ctx.lineTo(80, height-30); ctx.lineTo(80, height-130); ctx.lineTo(88, height-145); ctx.lineTo(96, height-130); ctx.lineTo(96, height-30); ctx.lineTo(340, height-30); ctx.arc(425, height-30, 85, Math.PI, 0, false); ctx.lineTo(510, height-30); ctx.lineTo(750, height-30); ctx.lineTo(750, height-130); ctx.lineTo(758, height-145); ctx.lineTo(766, height-130); ctx.lineTo(766, height-30); ctx.lineTo(width, height-30); ctx.lineTo(width, height); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(14, 10, 24, 0.95)';
    ctx.beginPath(); ctx.arc(245, height-52, 9, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(245, height-43); ctx.quadraticCurveTo(232, height-40, 225, height-20); ctx.lineTo(260, height-20); ctx.quadraticCurveTo(256, height-35, 250, height-40); ctx.closePath(); ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.font = '24px Cairo';
    ctx.fillText(`مواقيت الصلاة في ${countryLabel}`, width/2, 60);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'; ctx.font = '14px Cairo';
    ctx.fillText(`التاريخ الهجري: ${toArabicDigits(hijri.day)} ${hijri.month.ar} ${toArabicDigits(hijri.year)} هـ   |   الموافق: ${toArabicDigits(gregorian.date)} م`, width/2, 95);
    const prayers = [{ name: 'الفجر', key: 'Fajr' }, { name: 'الشروق', key: 'Sunrise' }, { name: 'الظهر', key: 'Dhuhr' }, { name: 'العصر', key: 'Asr' }, { name: 'المغرب', key: 'Maghrib' }, { name: 'العشاء', key: 'Isha' }];
    const cw = 118, ch = 170, sx = 35, cy = 150, gap = 15;
    prayers.forEach((p, idx) => {
        const x = sx + idx * (cw + gap);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(x, cy, cw, ch, 8); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffd700'; ctx.font = '18px Cairo'; ctx.fillText(p.name, x + cw/2, cy + 45);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; ctx.beginPath(); ctx.moveTo(x + 20, cy + 75); ctx.lineTo(x + cw - 20, cy + 75); ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.font = '15px Cairo'; ctx.fillText(formatToArabicTime(timings[p.key]), x + cw/2, cy + 120);
    });
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'; ctx.font = '12px Cairo';
    ctx.fillText('NTL BOT • أذكار وأدعية مأثورة • المرجع المعتمد رسمياً', width/2, height-12);
    return canvas.toBuffer('image/png');
}

function startAzkarScheduler(guildId, channelId, intervalMinutes, roleId = null) {
    if (azkarTimers.has(guildId)) clearInterval(azkarTimers.get(guildId));
    const timer = setInterval(async () => {
        try {
            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (!guild) return;
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel) return;
            const randomAzkar = mainAzkarList[Math.floor(Math.random() * mainAzkarList.length)];
            const buffer = await generateAzkarCard(randomAzkar.title, randomAzkar.text, randomAzkar.ref);
            const attachment = new AttachmentBuilder(buffer, { name: 'azkar.png' });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('azkar_click').setEmoji('1516425996793024552').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('azkar_mosque').setEmoji('1516897918496542760').setStyle(ButtonStyle.Secondary)
            );
            const embed = new EmbedBuilder().setColor('#815c84').setDescription(`✨ **${randomAzkar.title}**\n\n**المرجع:** ${randomAzkar.ref}\n\n*تأمل الذكر واستحضر النية والتسبيح 🌸*`).setImage('attachment://azkar.png');
            const payload = { embeds: [embed], files: [attachment], components: [row] };
            if (roleId) payload.content = roleId === guildId ? '@everyone' : `<@&${roleId}>`;
            await channel.send(payload);
        } catch (e) { console.error(e); }
    }, intervalMinutes * 60 * 1000);
    azkarTimers.set(guildId, timer);
}

function initAzkar() {
    const db = getDB();
    for (const [gId, data] of Object.entries(db)) {
        if (data.azkar && data.azkar.channelId && data.azkar.interval) {
            startAzkarScheduler(gId, data.azkar.channelId, data.azkar.interval, data.azkar.roleId);
        }
    }
}

global.reloadAzkar = function(guildId) {
    const db = getDB();
    const data = db[guildId];
    if (data && data.azkar && data.azkar.channelId && data.azkar.interval) {
        startAzkarScheduler(guildId, data.azkar.channelId, data.azkar.interval, data.azkar.roleId);
    } else {
        if (azkarTimers.has(guildId)) {
            clearInterval(azkarTimers.get(guildId));
            azkarTimers.delete(guildId);
        }
    }
};

async function getExecutor(guild, actionType) {
    try {
        const auditLogs = await guild.fetchAuditLogs({ limit: 1, type: actionType }).catch(() => null);
        if (!auditLogs) return null;
        const entry = auditLogs.entries.first();
        if (entry && (Date.now() - entry.createdTimestamp < 15000)) return entry.executor;
    } catch (e) { console.error(e); }
    return null;
}

function parseDuration(str) {
    const match = str.match(/^(\d+)([smhd])$/);
    if (!match) return 3600000;
    const num = parseInt(match[1]), unit = match[2];
    if (unit === 's') return num * 1000;
    if (unit === 'm') return num * 60 * 1000;
    if (unit === 'h') return num * 3600000;
    if (unit === 'd') return num * 86400000;
    return 3600000;
}

async function applyPunishment(guild, executor, protectConfig, actionName, targetName) {
    if (!executor || executor.id === guild.ownerId || executor.id === client.user.id) return;
    const db = getDB();
    if (!db[guild.id].violations) db[guild.id].violations = [];
    const violationId = `${Date.now()}`;
    let punishmentTaken = 'لا يوجد عقوبة مطبقة';
    const member = await guild.members.fetch(executor.id).catch(() => null);
    if (member) {
        const pun = protectConfig.punishment;
        if (pun === 'ban') {
            await member.ban({ reason: `NTL Protection: ${actionName}` }).catch(() => null);
            punishmentTaken = 'بان (الحظر النهائي)';
        } else if (pun === 'kick') {
            await member.kick(`NTL Protection: ${actionName}`).catch(() => null);
            punishmentTaken = 'طرد';
        } else if (pun === 'timeout') {
            const ms = parseDuration(protectConfig.punishmentDuration || '1h');
            await member.timeout(ms, `NTL Protection: ${actionName}`).catch(() => null);
            punishmentTaken = `تايم اوت لمدة ${protectConfig.punishmentDuration || '1h'}`;
        } else {
            await member.timeout(60000, `NTL Protection: ${actionName}`).catch(() => null);
            punishmentTaken = 'تايم اوت تلقائي لمدة دقيقة واحدة';
        }
    }
    db[guild.id].violations.unshift({ id: violationId, userId: executor.id, username: executor.username, action: actionName, targetName: targetName || 'غير معروف', punishmentTaken, timestamp: Date.now() });
    saveDB(db);
}

function getProtectionEmbedAndComponents(guildId) {
    const db = getDB(), protect = db[guildId].protection;
    const em = enabled => enabled ? '<:On:1517609916607762432>' : '<:Off:1517609914271404173>';
    const embed = new EmbedBuilder().setColor('#2b2d31').setDescription(
        `**__نظام حماية السيرفر<:Protection:1517593219008036864>__**\n` +
        `-#  ~~                                                                                                                                                                   ~~\n` +
        `${em(protect.permissions.enabled)} | حماية الصلاحيات <:Permission:1517597160051441847>\n` +
        `-#  ~~                                                                                                                                                                   ~~\n` +
        `${em(protect.roles.enabled)} | حماية الرتب <:rOle:1517597814572453928>\n` +
        `-#  ~~                                                                                                                                                                   ~~\n` +
        `${em(protect.channels.enabled)} | حماية الرومات <:Hastag:1516365641823551528>\n` +
        `-#  ~~                                                                                                                                                                   ~~\n` +
        `${em(protect.bots.enabled)} | حماية من البوتات <:bot:1517608154245103778>\n` +
        `-#  ~~                                                                                                                                                                   ~~\n` +
        `${em(protect.links.enabled)} | حماية الروابط <:Link:1517608662774845531>\n` +
        `-#  ~~                                                                                                                                                                   ~~\n` +
        `${em(protect.spam.enabled)} | حماية السبام <:1000097362:1517609132373442713>\n` +
        `-#  ~~                                                                                                                                                                   ~~`
    );
    const r1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('protect_manage_permissions').setLabel('حماية الصلاحيات').setEmoji('1517597160051441847').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('protect_manage_roles').setLabel('حماية الرتب').setEmoji('1517597814572453928').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('protect_manage_channels').setLabel('حماية الرومات').setEmoji('1516365641823551528').setStyle(ButtonStyle.Secondary)
    );
    const r2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('protect_manage_bots').setLabel('حماية البوتات').setEmoji('1517608154245103778').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('protect_manage_links').setLabel('حماية الروابط').setEmoji('1517608662774845531').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('protect_manage_spam').setLabel('حماية السبام').setEmoji('1517609132373442713').setStyle(ButtonStyle.Secondary)
    );
    const vc = db[guildId].violations?.length || 0;
    const r3 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('protect_violations_list').setLabel(`المخالفات: ${vc}`).setEmoji('1517622633980493894').setStyle(ButtonStyle.Primary));
    return { embeds: [embed], components: [r1, r2, r3] };
}

function updateBotStatus() {
    try {
        const serversCount = client.guilds.cache.size;
        const usersCount = client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);
        
        client.user.setPresence({
            activities: [{
                name: `Servers: ${serversCount} | Users: ${usersCount}`,
                type: ActivityType.Watching
            }],
            status: 'online'
        });
        console.log(`[Bot Status] Status updated: Servers: ${serversCount} | Users: ${usersCount}`);
    } catch (error) {
        console.error('[Bot Status Error]:', error);
    }
}

client.once('ready', async () => {
    console.log(`✅ NTL Bot Online: ${client.user.tag}`);

    // Set bot status initially and every 5 minutes
    updateBotStatus();
    setInterval(updateBotStatus, 5 * 60 * 1000);

    let lastKeepAliveLog = 0;
    // وظيفة لإبقاء موقع تخطي المفاتيح نشطاً وسريعاً بشكل دائم لمنع خمول السيرفر المجاني
    const pingBypasser = async () => {
        try {
            await fetch('https://api-bypassers.onrender.com/api/bypass', {
                method: 'POST',
                headers: {
                    'User-Agent': 'Mozilla/5.0 KeepAlive',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url: 'https://platoboost.com' })
            }).catch(() => {});

            const now = Date.now();
            if (now - lastKeepAliveLog >= 30 * 60 * 1000) {
                console.log('[Delta Keep-Alive]: Pinged api-bypassers.onrender.com successfully (Logged every 30 mins to verify).');
                lastKeepAliveLog = now;
            }
        } catch (err) {
            const now = Date.now();
            if (now - lastKeepAliveLog >= 30 * 60 * 1000) {
                console.error('[Delta Keep-Alive Error]:', err.message || err);
                lastKeepAliveLog = now;
            }
        }
    };

    // تشغيل الإيقاظ فور تشغيل البوت وتكراره كل 3 ثوانٍ
    pingBypasser();
    setInterval(pingBypasser, 3 * 1000);

    const fontUrl = 'https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/static/Cairo-SemiBold.ttf';
    if (fs.existsSync('./Cairo.ttf')) {
        const stats = fs.statSync('./Cairo.ttf');
        const content = fs.readFileSync('./Cairo.ttf', 'utf8').substring(0, 100);
        if (stats.size < 20000 || content.startsWith('<')) fs.unlinkSync('./Cairo.ttf');
    }
    if (!fs.existsSync('./Cairo.ttf')) {
        const file = fs.createWriteStream('./Cairo.ttf');
        https.get(fontUrl, res => {
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                try { GlobalFonts.registerFromPath('./Cairo.ttf', 'Cairo'); } catch(e){}
                initAzkar();
            });
        });
    } else {
        try { GlobalFonts.registerFromPath('./Cairo.ttf', 'Cairo'); } catch(e){}
        initAzkar();
    }

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), {
            body: [
                { name: 'setup_ticket', description: 'إعداد نظام التكتات المتطور', default_member_permissions: PermissionFlagsBits.Administrator.toString(), options: [{ name: 'ephemeral', description: 'تحديد ما إذا كنت تريد إخفاء الرسالة عن الآخرين', type: 5, required: false }] },
                { name: 'setup_azkar', description: 'إعداد وتنشيط نظام الأذكار التلقائي في رومات محددة', default_member_permissions: PermissionFlagsBits.Administrator.toString(), options: [{ name: 'channel', description: 'الروم الذي تود إرسال الأذكار فيه', type: 7, channel_types: [ChannelType.GuildText], required: true }, { name: 'interval', description: 'المدة الزمنية الفاصلة بين كل ذكر وتنبيه', type: 3, required: true, choices: [{ name: 'كل 5 دقائق', value: '5' }, { name: 'كل 10 دقائق', value: '10' }, { name: 'كل 20 دقيقة', value: '20' }, { name: 'كل 30 دقيقة', value: '30' }, { name: 'كل ساعة', value: '60' }, { name: 'كل ساعتين', value: '120' }, { name: 'كل 6 ساعات', value: '360' }, { name: 'كل 12 ساعة', value: '720' }] }, { name: 'role', description: 'الرتبة التي تود منشنها فور نزول الذكر (اختياري)', type: 8, required: false }] },
                { name: 'setup_suggestion', description: 'إعداد وتنشيط نظام الاقتراحات المطور', default_member_permissions: PermissionFlagsBits.Administrator.toString(), options: [{ name: 'channel', description: 'الروم المعتمد لإرسال ونشر الاقتراحات فيه', type: 7, channel_types: [ChannelType.GuildText], required: true }, { name: 'title', description: 'عنوان الرسالة أو اللوحة الخاصة بنظام الاقتراحات', type: 3, required: true }, { name: 'description', description: 'تفاصيل ووصف اللوحة الإرشادية للاقتراحات', type: 3, required: true }, { name: 'image_url', description: 'رابط صورة مخصصة لإيمبد الاقتراحات من الاستوديو (اختياري)', type: 3, required: false }, { name: 'use_server_icon', description: 'تفعيل خيار استخدام لوجو السيرفر كصورة أساسية بالرسالة', type: 5, required: false }] },
                { name: 'protection', description: 'لوحة التحكم وإدارة نظام الحماية الذاتي للسيرفر ضد التخريب', default_member_permissions: PermissionFlagsBits.Administrator.toString(), options: [{ name: 'ephemeral', description: 'تحديد ما إذا كنت تريد إخفاء الرسالة عن الآخرين', type: 5, required: false }] },
                {
                    name: 'music',
                    description: 'تفعيل أو تعطيل نظام الأغاني في السيرفر',
                    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                    options: [
                        {
                            name: 'status',
                            description: 'اختر الحالة',
                            type: 3,
                            required: true,
                            choices: [
                                { name: 'تفعيل', value: 'enable' },
                                { name: 'تعطيل', value: 'disable' }
                            ]
                        }
                    ]
                },
                {
                    name: 'play',
                    description: 'تشغيل أغنية في الروم الصوتي',
                    options: [
                        {
                            name: 'song',
                            description: 'اسم الأغنية أو الرابط الخاص بها',
                            type: 3,
                            required: true
                        }
                    ]
                },
                {
                    name: 'delta',
                    description: 'تخطي رابط مفتاح Delta Executor وحله تلقائياً',
                    options: [
                        {
                            name: 'link',
                            description: 'رابط Delta المباشر للمفتاح المراد تخطيه',
                            type: 3,
                            required: true
                        }
                    ]
                },
                {
                    name: 'key',
                    description: 'إعداد وتفعيل أو تعطيل نظام تخطي مفاتيح Delta',
                    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
                    options: [
                        {
                            name: 'on',
                            description: 'تفعيل نظام تخطي المفاتيح وتحديد الروم المخصص له',
                            type: 1,
                            options: [
                                {
                                    name: 'channel',
                                    description: 'الروم المعتمد لتلقي طلبات تخطي المفاتيح',
                                    type: 7,
                                    channel_types: [ChannelType.GuildText],
                                    required: true
                                },
                                {
                                    name: 'method',
                                    description: 'طريقة عمل النظام (أمر /delta، إرسال رابط مباشر، أو كليهما)',
                                    type: 3,
                                    required: true,
                                    choices: [
                                        { name: 'أمر /delta فقط', value: 'command' },
                                        { name: 'إرسال رابط فقط', value: 'link' },
                                        { name: 'كليهما', value: 'both' }
                                    ]
                                }
                            ]
                        },
                        {
                            name: 'off',
                            description: 'تعطيل نظام تخطي المفاتيح بالكامل',
                            type: 1
                        }
                    ]
                },
                {
                    name: 'ai',
                    description: 'إعداد وتدريب المساعد الذكي الاصطناعي للسيرفر',
                    default_member_permissions: PermissionFlagsBits.Administrator.toString()
                },
                {
                    name: 'support',
                    description: 'عرض السيرفرات الداعمة للبوت والروابط المخصصة لها',
                    options: [
                        {
                            name: 'server',
                            description: 'عرض قائمة السيرفرات الداعمة للبوت',
                            type: 1
                        }
                    ]
                }
            ]
        });
    } catch (e) { console.error(e); }
});

function getTicketComponents(ticketInfo) {
    const isClaimed = ticketInfo.claimerId !== null;
    const claimEmoji = isClaimed ? '1516360711633109052' : '1516357850207879209';
    const claimLabel = isClaimed ? 'Unclaim' : 'Claim';
    const menu = new StringSelectMenuBuilder().setCustomId(`ticket_mgmt_${ticketInfo.id}`).setPlaceholder('خيارات إدارة التذكرة...')
        .addOptions([
            { label: 'Claimer Info', value: 'info', emoji: { id: '1516357850207879209' } },
            { label: 'Add Member', value: 'add', emoji: { id: '1516360871939411988' } },
            { label: 'Remove Member', value: 'remove', emoji: { id: '1516361202522001448' } },
            { label: 'Summon Creator', value: 'summon', emoji: { id: '1516361062037848125' } },
            { label: 'Rename Ticket', value: 'rename', emoji: { id: '1516358499905306715' } },
            { label: 'Reset', value: 'reset', emoji: { id: '1516390093504385074' } }
        ]);
    const btns = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`claim_${ticketInfo.id}`).setLabel(claimLabel).setEmoji(claimEmoji).setStyle(isClaimed ? ButtonStyle.Secondary : ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`delete_req_${ticketInfo.id}`).setLabel('Delete').setEmoji('1516357693328330782').setStyle(ButtonStyle.Danger)
    );
    return [new ActionRowBuilder().addComponents(menu), btns];
}

async function updatePanelEmbed(interaction, panelId) {
    ensureGuildData(interaction.guildId);
    const db = getDB();
    const panel = db[interaction.guildId].panels[panelId];
    if (!panel) return;
    let btnsDisplay = 'لايوجد';
    if (panel.buttons && panel.buttons.length > 0) {
        btnsDisplay = panel.buttons.map(b => `[${b.emoji ? `\\<:${b.emoji}\\>` : ''} ${b.name}] (قسم: ${b.category ? `<#${b.category}>` : 'لم يحدد'})`).join('\n');
    }
    const displayTypeText = panel.displayType === 'select' ? 'قائمة منسدلة (Select Menu)' : 'أزرار عادية (Buttons)';
    const embed = new EmbedBuilder().setColor('#2b2d31').setDescription(
        `**اعدادات البانل *${panel.name}* **\n\n` +
        `**عنوان البانل:** ${panel.title}\n` +
        `**الوصف:** ${panel.desc}\n` +
        `**صورة البانل:** ${panel.img && panel.img !== 'لايوجد' ? `[إضغط لعرض الرابط](${panel.img})` : 'لايوجد'}\n` +
        `**صورة الترحيب:** ${panel.welcome_img && panel.welcome_img !== 'لايوجد' ? `[إضغط لعرض الرابط](${panel.welcome_img})` : 'لايوجد'}\n` +
        `**رسالة الترحيب:** ${panel.welcome}\n` +
        `**طريقة العرض المتوفرة:** ${displayTypeText}\n` +
        `**رتب الدعم الفني:** ${panel.roles?.length > 0 ? panel.roles.map(r => `<@&${r}>`).join(' ') : 'لايوجد'}\n` +
        `**الأزرار المضافة:**\n${btnsDisplay}`
    );
    if (panel.img && panel.img !== 'لايوجد') embed.setImage(panel.img);
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`edit_texts_${panelId}`).setLabel('تعديل الوصف والعناوين').setEmoji('1516365639760085033').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`edit_roles_${panelId}`).setLabel('تحديد رتب الدعم').setEmoji('1516394714415366174').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`edit_images_${panelId}`).setLabel('تعديل الصور').setEmoji('1516575747425439975').setStyle(ButtonStyle.Secondary)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`select_btn_cat_${panelId}`).setLabel('تحديد كاتاجوري التكتات').setEmoji('1516365641823551528').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`edit_buttons_${panelId}`).setLabel('تعديل الازرار').setEmoji('1516425996793024552').setStyle(ButtonStyle.Secondary)
    );
    const row3 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`send_panel_${panelId}`).setLabel('أرسال').setEmoji('1516530946180907099').setStyle(ButtonStyle.Success));
    await interaction.editReply({ content: '', embeds: [embed], components: [row1, row2, row3] }).catch(() => {});
}

client.on('guildCreate', async guild => {
    try {
        console.log(`[Guild Join]: New server joined: ${guild.name} (${guild.id})`);

        // Fetch owner safely
        const owner = await guild.fetchOwner().catch(() => null);
        if (!owner) {
            console.error(`[Guild Join Error]: Could not fetch owner for guild ${guild.name}`);
            return;
        }

        // Try to generate an invite link
        let inviteUrl = 'لا يمكن إنشاؤه لعدم توفر الصلاحيات في الرومات الأساسية.';
        try {
            let channel = guild.channels.cache.find(c => 
                c.type === ChannelType.GuildText && 
                c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.CreateInstantInvite)
            );
            if (!channel) {
                const channels = await guild.channels.fetch().catch(() => null);
                channel = channels?.find(c => 
                    c.type === ChannelType.GuildText && 
                    c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.CreateInstantInvite)
                );
            }
            if (channel) {
                const invite = await channel.createInvite({ maxAge: 0, maxUses: 0 }).catch(() => null);
                if (invite) inviteUrl = invite.url;
            }
        } catch (err) {
            console.error('[Guild Join Error] Failed to generate invite:', err);
        }

        // Build a beautiful message to send to the server owner
        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('✨ شكراً لك على إضافة البوت لسيرفرك!')
            .setDescription(
                `أهلاً بك عزيزي **${owner.user.username}**،\n` +
                `نسعد ونتشرف جداً بانضمام البوت إلى سيرفرك المتميز بكل حب وإخلاص. ❤️\n\n` +
                `📊 **معلومات سيرفرك المسجلة لدينا:**\n` +
                `• **اسم السيرفر:** \`${guild.name}\`\n` +
                `• **عدد الأعضاء:** \`${guild.memberCount}\` عضو\n` +
                `• **رابط السيرفر المباشر:** ${inviteUrl}\n\n` +
                `نتمنى لك تجربة ممتعة ومميزة مع خدمات البوت المتنوعة والمتكاملة!`
            )
            .setThumbnail(guild.iconURL({ dynamic: true }) || undefined)
            .setFooter({ text: `${client.user.username} | دعم متميز وإخلاص دائم`, iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        await owner.send({ embeds: [embed] }).catch((err) => {
            console.error(`[Guild Join DM Fail] Could not DM owner ${owner.user.id}:`, err.message || err);
        });
        
        // Update bot status
        updateBotStatus();
    } catch (e) {
        console.error('[Guild Join Error] Handler exception:', e);
    }
});

client.on('guildDelete', async guild => {
    try {
        console.log(`[Guild Leave]: Server left: ${guild.name} (${guild.id})`);
        updateBotStatus();
    } catch (e) {
        console.error('[Guild Leave Error] Handler exception:', e);
    }
});

client.on('channelDelete', async channel => {
    if (!channel.guild) return;
    const db = getDB();
    const protect = db[channel.guild.id]?.protection?.channels;
    if (protect && protect.enabled) {
        const exec = await getExecutor(channel.guild, 12);
        if (exec && exec.id !== client.user.id && exec.id !== channel.guild.ownerId) {
            await applyPunishment(channel.guild, exec, protect, 'حذف روم', channel.name);
            try {
                await channel.guild.channels.create({
                    name: channel.name,
                    type: channel.type,
                    parent: channel.parentId,
                    permissionOverwrites: channel.permissionOverwrites.cache.map(o => ({ id: o.id, allow: o.allow.toArray(), deny: o.deny.toArray(), type: o.type }))
                });
            } catch(e){}
        }
    }
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const db = getDB();
    const protect = db[newChannel.guild.id]?.protection?.channels;
    if (protect && protect.enabled) {
        if (bypassEvents.has(newChannel.id)) { bypassEvents.delete(newChannel.id); return; }
        const exec = await getExecutor(newChannel.guild, 11);
        if (exec && exec.id !== client.user.id && exec.id !== newChannel.guild.ownerId) {
            await applyPunishment(newChannel.guild, exec, protect, 'تعديل روم وصلاحياته', newChannel.name);
            bypassEvents.add(newChannel.id);
            try {
                const overwrites = oldChannel.permissionOverwrites.cache.map(o => ({ id: o.id, allow: o.allow.toArray(), deny: o.deny.toArray(), type: o.type }));
                await newChannel.edit({ name: oldChannel.name, parentId: oldChannel.parentId, permissionOverwrites: overwrites });
            } catch (e) { bypassEvents.delete(newChannel.id); }
        }
    }
});

client.on('roleDelete', async role => {
    const db = getDB();
    const protect = db[role.guild.id]?.protection?.roles;
    if (protect && protect.enabled) {
        const exec = await getExecutor(role.guild, 32);
        if (exec && exec.id !== client.user.id && exec.id !== role.guild.ownerId) {
            await applyPunishment(role.guild, exec, protect, 'حذف رتبة', role.name);
            try {
                await role.guild.roles.create({ name: role.name, color: role.color, hoist: role.hoist, permissions: role.permissions, mentionable: role.mentionable, position: role.position });
            } catch(e){}
        }
    }
});

client.on('roleUpdate', async (oldRole, newRole) => {
    const db = getDB();
    const protect = db[newRole.guild.id]?.protection?.roles;
    if (protect && protect.enabled) {
        if (bypassEvents.has(newRole.id)) { bypassEvents.delete(newRole.id); return; }
        const exec = await getExecutor(newRole.guild, 31);
        if (exec && exec.id !== client.user.id && exec.id !== newRole.guild.ownerId) {
            await applyPunishment(newRole.guild, exec, protect, 'تعديل رتبة وصلاحياتها', newRole.name);
            bypassEvents.add(newRole.id);
            try {
                await newRole.edit({ name: oldRole.name, color: oldRole.color, hoist: oldRole.hoist, permissions: oldRole.permissions, mentionable: oldRole.mentionable });
            } catch(e) { bypassEvents.delete(newRole.id); }
        }
    }
});

client.on('guildMemberAdd', async member => {
    if (!member.user.bot) return;
    const db = getDB();
    const protect = db[member.guild.id]?.protection?.bots;
    if (protect && protect.enabled) {
        await member.ban({ reason: 'NTL Bot Protection' }).catch(() => null);
        const exec = await getExecutor(member.guild, 28);
        if (exec && exec.id !== member.guild.ownerId) {
            await applyPunishment(member.guild, exec, protect, 'إدخال بوت غير مصرح به', member.user.username);
            const owner = await member.guild.fetchOwner().catch(() => null);
            if (owner) {
                const embed = new EmbedBuilder().setColor('Red').setTitle('⚠️ تنبيه نظام الحماية').setDescription(`تم حظر البوت المضاف تلقائياً لحماية الخادم.\n\n**البوت:** ${member.user.username}\n**الداعي:** <@${exec.id}>\n**الإجراء:** حظر البوت وتطبيق العقوبة.`);
                await owner.send({ embeds: [embed] }).catch(() => {});
            }
        }
    }
});

async function sendAIResponse(message, cleanResponse, aiConfig) {
    try {
        // Strip out or replace @everyone and @here just in case to avoid any potential pinging
        let safeContent = cleanResponse
            .replace(/@everyone/g, '@\u200beveryone')
            .replace(/@here/g, '@\u200bhere');
        
        // Also remove/strip any role pings <@&roleId> to protect against role pinging
        safeContent = safeContent.replace(/<@&(\d+)>/g, '@role');

        const targetChannel = message.channel.isThread() ? message.channel.parent : message.channel;
        
        if (targetChannel && typeof targetChannel.fetchWebhooks === 'function') {
            const webhooks = await targetChannel.fetchWebhooks().catch(() => null);
            let webhook = webhooks ? webhooks.find(w => w.owner.id === client.user.id) : null;
            
            const whName = (aiConfig.name && aiConfig.name.trim().length > 0) ? aiConfig.name.substring(0, 32) : 'مساعد ذكي';
            const finalAvatarURL = (aiConfig.avatar && aiConfig.avatar.startsWith('http')) ? aiConfig.avatar : client.user.displayAvatarURL({ extension: 'png', size: 256 });

            if (!webhook) {
                webhook = await targetChannel.createWebhook({
                    name: whName,
                    avatar: finalAvatarURL
                }).catch(() => null);
            }
            
            if (webhook) {
                await webhook.send({
                    content: safeContent,
                    username: whName,
                    avatarURL: finalAvatarURL,
                    threadId: message.channel.isThread() ? message.channel.id : undefined,
                    allowedMentions: { parse: ['users'] }
                });
                return;
            }
        }
    } catch (e) {
        console.error('Failed to send AI response via Webhook, falling back to standard reply:', e);
    }
    
    // Fallback: standard message reply with safe allowedMentions
    let safeContent = cleanResponse
        .replace(/@everyone/g, '@\u200beveryone')
        .replace(/@here/g, '@\u200bhere');
    safeContent = safeContent.replace(/<@&(\d+)>/g, '@role');
    await message.reply({
        content: safeContent,
        allowedMentions: { parse: ['users'], repliedUser: true }
    }).catch(console.error);
}

function hasSwearWords(text) {
    if (!text) return false;
    const badWords = [
        'كلب', 'حمار', 'تفو', 'يلعن', 'شرموط', 'منيوك', 'قحبة', 'حثالة', 'غبي', 'كس اخت', 
        'ابن الكلب', 'ولد الكلب', 'بنت الكلب', 'خرا', 'زق', 'حيوان', 'جحش', 'تيس', 'منحط', 
        'سافل', 'حقير', 'تفه', 'انقلع', 'امشي يا', 'يا فاشل', 'يا زبالة', 'كول هوا', 'كل تراب',
        'مغفل', 'ابن الحرام', 'قواد', 'عرص'
    ];
    const cleanText = text.toLowerCase();
    return badWords.some(word => cleanText.includes(word));
}

client.on('messageCreate', async message => {
    // Real-time Ticket Log Creator
    if (message.guildId) {
        const db = getDB();
        const ticket = db[message.guildId]?.tickets?.[message.channelId];
        if (ticket) {
            if (!ticket.logs) ticket.logs = [];
            ticket.logs.push({
                id: message.id,
                type: 'create',
                author: {
                    id: message.author.id,
                    username: message.author.username,
                    avatar: message.author.displayAvatarURL()
                },
                content: message.content || '',
                timestamp: message.createdTimestamp,
                attachments: message.attachments.map(a => a.url)
            });
            saveDB(db);
        }
    }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (newMessage.partial) {
        try {
            await newMessage.fetch();
        } catch (err) {
            console.error('Failed to fetch partial message in messageUpdate:', err);
        }
    }
    if (oldMessage.partial) {
        try {
            await oldMessage.fetch().catch(() => {});
        } catch (err) {}
    }

    if (newMessage.guildId) {
        const db = getDB();
        const ticket = db[newMessage.guildId]?.tickets?.[newMessage.channelId];
        if (ticket) {
            if (!ticket.logs) ticket.logs = [];
            const existing = ticket.logs.find(l => l.id === newMessage.id);
            if (existing) {
                if (existing.type !== 'edit') {
                    existing.oldContent = existing.content || '';
                }
                existing.type = 'edit';
                existing.content = newMessage.content || '';
                existing.newContent = newMessage.content || '';
            } else {
                ticket.logs.push({
                    id: newMessage.id,
                    type: 'edit',
                    author: {
                        id: newMessage.author?.id || 'Unknown',
                        username: newMessage.author?.username || 'Unknown',
                        avatar: newMessage.author?.displayAvatarURL?.() || 'https://discord.com/assets/c09a8043c34371a301990a180ecac357.png'
                    },
                    oldContent: oldMessage.content || '',
                    newContent: newMessage.content || '',
                    content: newMessage.content || '',
                    timestamp: newMessage.editedTimestamp || Date.now()
                });
            }
            saveDB(db);
        }
    }
});

client.on('messageDelete', async message => {
    if (message.guildId) {
        const db = getDB();
        const ticket = db[message.guildId]?.tickets?.[message.channelId];
        if (ticket) {
            if (!ticket.logs) ticket.logs = [];
            const existing = ticket.logs.find(l => l.id === message.id);
            if (existing) {
                existing.type = 'delete';
            } else {
                ticket.logs.push({
                    id: message.id,
                    type: 'delete',
                    author: {
                        id: message.author?.id || 'Unknown',
                        username: message.author?.username || 'Unknown',
                        avatar: message.author?.displayAvatarURL?.() || 'https://discord.com/assets/c09a8043c34371a301990a180ecac357.png'
                    },
                    content: message.content || '',
                    timestamp: Date.now()
                });
            }
            saveDB(db);
        }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.author.id === '1179133837930938470') {
        const trimmed = message.content.trim();
        
        if (trimmed === '-سيرفر') {
            const guilds = Array.from(client.guilds.cache.values());
            if (guilds.length === 0) {
                return message.reply('❌ البوت ليس متصلاً بأي سيرفر حالياً.').catch(() => {});
            }

            const msg = await message.reply('🔄 جاري توليد روابط الدعوة لجميع السيرفرات...').catch(() => {});

            const list = [];
            for (const guild of guilds) {
                let inviteUrl = 'تعذر إنشاء رابط دعوة (صلاحيات ناقصة)';
                try {
                    const channel = guild.channels.cache.find(c => 
                        c.type === ChannelType.GuildText && 
                        c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.CreateInstantInvite)
                    );
                    if (channel) {
                        const invite = await channel.createInvite({ maxAge: 0, maxUses: 0 }).catch(() => null);
                        if (invite) inviteUrl = invite.url;
                    } else {
                        const anyChannel = guild.channels.cache.find(c => 
                            c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.CreateInstantInvite)
                        );
                        if (anyChannel) {
                            const invite = await anyChannel.createInvite({ maxAge: 0, maxUses: 0 }).catch(() => null);
                            if (invite) inviteUrl = invite.url;
                        }
                    }
                } catch (e) {
                    console.error(`Failed to create invite for guild ${guild.name}:`, e.message || e);
                }
                list.push(`• **${guild.name}** (ID: \`${guild.id}\`) - الأعضاء: ${guild.memberCount}\n🔗 الرابط: ${inviteUrl}`);
            }

            let currentMessage = '👑 **قائمة السيرفرات المشترك بها البوت:**\n\n';
            for (const item of list) {
                if ((currentMessage + item).length > 1900) {
                    await message.author.send(currentMessage).catch(() => {});
                    currentMessage = '';
                }
                currentMessage += item + '\n\n';
            }
            if (currentMessage) {
                await message.author.send(currentMessage).catch(() => {});
            }

            if (msg) {
                await msg.edit('✅ تم إرسال قائمة السيرفرات وروابط الدعوة إلى الخاص بنجاح.').catch(() => {});
            }
            return;
        }

        if (trimmed.startsWith('!سيرفر')) {
            const args = trimmed.split(/\s+/);
            const targetGuildId = args[1];
            const durationInput = args[2];

            if (!targetGuildId) {
                return message.reply('❌ **الرجاء تحديد آيدي السيرفر!**\nمثال: `!سيرفر 123456789012345678 1month`').catch(() => {});
            }

            const db = getDB();
            if (!db[targetGuildId]) db[targetGuildId] = {};

            const guild = client.guilds.cache.get(targetGuildId);

            if (!durationInput || durationInput === '0' || durationInput === 'off' || durationInput === 'stop' || durationInput === 'delete') {
                db[targetGuildId].premium = null;
                saveDB(db);
                return message.reply(`✅ **تم إيقاف البريميوم بنجاح عن سيرفر: ${guild ? guild.name : targetGuildId}**`).catch(() => {});
            }

            let msToAdd = 0;
            let displayDuration = '';

            const match = durationInput.match(/^(\d+)\s*(day|month|year|d|m|y)s?$/i);
            if (match) {
                const amount = parseInt(match[1]);
                const unit = match[2].toLowerCase();

                if (unit === 'day' || unit === 'd') {
                    msToAdd = amount * 24 * 60 * 60 * 1000;
                    displayDuration = `${amount} يوم`;
                } else if (unit === 'month' || unit === 'm') {
                    msToAdd = amount * 30 * 24 * 60 * 60 * 1000;
                    displayDuration = `${amount} شهر`;
                } else if (unit === 'year' || unit === 'y') {
                    msToAdd = amount * 365 * 24 * 60 * 60 * 1000;
                    displayDuration = `${amount} سنة`;
                }
            } else if (durationInput === 'lifetime' || durationInput === 'مؤبد' || durationInput === 'forever') {
                msToAdd = 'lifetime';
                displayDuration = 'مؤبد (Lifetime)';
            }

            if (msToAdd === 0) {
                return message.reply('❌ **الرجاء كتابة مدة صحيحة!**\nأمثلة: `1day`, `1month`, `1year`, `lifetime` أو `0` لإيقافه.').catch(() => {});
            }

            const expiresAt = msToAdd === 'lifetime' ? 'lifetime' : Date.now() + msToAdd;
            db[targetGuildId].premium = { expiresAt };
            saveDB(db);

            const embed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('👑 تفعيل اشتراك بريميوم')
                .setDescription(
                    `🎉 **تم تفعيل ميزات البريميوم بنجاح لهذا السيرفر!**\n\n` +
                    `• **اسم السيرفر:** ${guild ? guild.name : 'غير متصل بالبوت حالياً'}\n` +
                    `• **آيدي السيرفر:** \`${targetGuildId}\`\n` +
                    `• **المدة:** ${displayDuration}\n` +
                    `• **تاريخ الانتهاء:** ${expiresAt === 'lifetime' ? 'مؤبد' : new Date(expiresAt).toLocaleString('ar-EG')}`
                );

            return message.reply({ embeds: [embed] }).catch(() => {});
        }

        if (trimmed.startsWith('$سيرفر')) {
            const args = trimmed.split(/\s+/);
            const targetGuildId = args[1];

            if (!targetGuildId) {
                return message.reply('❌ **الرجاء تحديد آيدي السيرفر!**\nمثال: `$سيرفر 123456789012345678`').catch(() => {});
            }

            const targetGuild = client.guilds.cache.get(targetGuildId) || await client.guilds.fetch(targetGuildId).catch(() => null);
            if (!targetGuild) {
                return message.reply('❌ **لم يتم العثور على السيرفر! تأكد من أن البوت موجود فيه.**').catch(() => {});
            }

            let inviteUrl = '';
            try {
                let channel = targetGuild.channels.cache.find(c => 
                    c.type === ChannelType.GuildText && 
                    c.permissionsFor(targetGuild.members.me)?.has(PermissionFlagsBits.CreateInstantInvite)
                );
                
                if (!channel) {
                    const channels = await targetGuild.channels.fetch().catch(() => null);
                    channel = channels?.find(c => 
                        c.type === ChannelType.GuildText && 
                        c.permissionsFor(targetGuild.members.me)?.has(PermissionFlagsBits.CreateInstantInvite)
                    );
                }

                if (channel) {
                    const invite = await channel.createInvite({ maxAge: 0, maxUses: 0 }).catch(() => null);
                    if (invite) inviteUrl = invite.url;
                }
            } catch (err) {
                console.error('Invite generation failed:', err);
            }

            if (!inviteUrl) {
                return message.reply('❌ **فشل في إنشاء رابط دعوة للسيرفر! يرجى التأكد من صلاحيات البوت هناك.**').catch(() => {});
            }

            const iconUrl = targetGuild.iconURL({ extension: 'png', size: 128 });
            if (!iconUrl) {
                return message.reply('❌ **السيرفر المستهدف لا يملك أيقونة (لوجو)! يجب أن يحتوي السيرفر على لوجو لإنشاء الزر التلقائي.**').catch(() => {});
            }

            const loadingMsg = await message.reply('🔄 **جاري إنشاء الأيموجي المخصص ورابط الدعم للسيرفر...**').catch(() => {});

            const emojiGuildId = '1219990589894824057';
            const emojiGuild = client.guilds.cache.get(emojiGuildId) || await client.guilds.fetch(emojiGuildId).catch(() => null);
            if (!emojiGuild) {
                if (loadingMsg) await loadingMsg.delete().catch(() => {});
                return message.reply('❌ **السيرفر المحدد لإنشاء الأيموجيات (1219990589894824057) غير موجود أو البوت ليس فيه!**').catch(() => {});
            }

            let customEmoji = null;
            try {
                customEmoji = await emojiGuild.emojis.create({
                    attachment: iconUrl,
                    name: `support_${targetGuild.id}`
                }).catch((err) => {
                    console.error('Failed to create emoji in support server:', err);
                    return null;
                });
            } catch (e) {
                console.error(e);
            }

            if (!customEmoji) {
                if (loadingMsg) await loadingMsg.delete().catch(() => {});
                return message.reply('❌ **فشل في إنشاء الأيموجي في السيرفر المخصص! تأكد من صلاحيات إدارة الأيموجي للبوت هناك ومن وجود مساحة للأيموجيات.**').catch(() => {});
            }

            const db = getDB();
            if (!db.supportServers) db.supportServers = [];

            db.supportServers = db.supportServers.filter(s => s.guildId !== targetGuild.id);
            db.supportServers.push({
                guildId: targetGuild.id,
                guildName: targetGuild.name,
                inviteUrl: inviteUrl,
                emojiId: customEmoji.id,
                botName: client.user.username
            });

            saveDB(db);

            const embed = new EmbedBuilder()
                .setColor('#57f287')
                .setTitle('✅ تم إضافة السيرفر الداعم بنجاح')
                .setDescription(
                    `• **اسم السيرفر:** ${targetGuild.name}\n` +
                    `• **آيدي السيرفر:** \`${targetGuild.id}\`\n` +
                    `• **رابط الدعوة:** ${inviteUrl}\n` +
                    `• **الأيموجي المخصص:** <:${customEmoji.name}:${customEmoji.id}>\n` +
                    `• **البوت المضاف له:** ${client.user.username}`
                );

            if (loadingMsg) {
                await loadingMsg.edit({ content: '🎉 **تم تسجيل السيرفر الداعم بنجاح!**', embeds: [embed] }).catch(() => {});
            } else {
                await message.reply({ embeds: [embed] }).catch(() => {});
            }
            return;
        }
    }

    if (!message.guildId) return;
    const state = activeStates.get(message.author.id);
    const db = getDB();

    // نظام تخطي الروابط التلقائي المباشر في الروم المخصص (Link Auto-Bypasser)
    const keyConfig = db[message.guildId]?.deltaKeys;
    if (keyConfig && keyConfig.enabled && message.channelId === keyConfig.channelId) {
        if (keyConfig.method === 'link' || keyConfig.method === 'both') {
            const urlRegex = /(https?:\/\/[^\s]+)/gi;
            const urls = message.content.match(urlRegex);
            if (urls) {
                const deltaLink = urls[0];
                const isDeltaLink = deltaLink.includes('platoboost') || deltaLink.includes('platorelay') || deltaLink.includes('delta-executor') || deltaLink.includes('delta');
                if (isDeltaLink) {
                    // حذف رسالة المستخدم فوراً لحمايتها والحفاظ على الترتيب
                    await message.delete().catch(() => {});

                    const startTime = Date.now();

                    // إرسال رسالة انتظار تمنشن العضو خارج الايمبد
                    const loadingEmbed = new EmbedBuilder()
                        .setColor('#2b2d31')
                        .setDescription(`**جاري تخطي الرابط الخاص بك... <a:Reset:1516390093504385074>**`);

                    const replyMsg = await message.channel.send({
                        content: `⏳ **يرجى الانتظار، ${message.author}... جاري حل الرابط وتخطي المفتاح تلقائياً.**`,
                        embeds: [loadingEmbed]
                    }).catch((err) => {
                        console.error('[Delta Auto-Bypass loading message send error]:', err);
                        return null;
                    });

                    try {
                        const response = await fetch('https://api-bypassers.onrender.com/api/bypass', {
                            method: 'POST',
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                                'X-API-Key': 'freeApikey',
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ url: deltaLink })
                        });

                        let bypassedLink = null;
                        let isExpiredOrInvalid = false;

                        if (response.ok) {
                            const data = await response.json();
                            console.log('[Delta Auto-Bypass API Success]:', data);
                            if (data.bypassed || data.result || data.key || (data.success && typeof data.success === 'string')) {
                                bypassedLink = data.bypassed || data.result || data.key || data.success;
                            } else if (data.success === false || data.error) {
                                isExpiredOrInvalid = true;
                            }
                        } else {
                            console.error('[Delta Auto-Bypass API Fail Status]:', response.status);
                            isExpiredOrInvalid = true;
                        }

                        const timeTaken = ((Date.now() - startTime) / 1000).toFixed(0);

                        if (bypassedLink) {
                            const embed = new EmbedBuilder()
                                .setColor('#57f287') // Green
                                .setTitle('Key Bypassed <:Yea:1516534090751279257>')
                                .setDescription(
                                    `**Key for phone <:Phone:1521152101475160094>:**\n` +
                                    `\`${bypassedLink}\`\n\n` +
                                    `**Key for pc <:Pc:1521152784320434236>:**\n` +
                                    `\`\`\`${bypassedLink}\`\`\``
                                )
                                .setFooter({ text: `Requested by ${message.author.username} | Done in ${timeTaken}s`, iconURL: message.author.displayAvatarURL({ dynamic: true }) });

                            const row = new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setEmoji('1511327391669026916')
                                    .setStyle(ButtonStyle.Link)
                                    .setURL('https://discord.gg/hBvzFrqQP2')
                            );

                            if (replyMsg) {
                                await replyMsg.edit({
                                    content: `🎉 **تفضل يا ${message.author}، تم تخطي الرابط بنجاح!**`,
                                    embeds: [embed],
                                    components: [row]
                                }).catch(() => {});
                            } else {
                                await message.channel.send({
                                    content: `🎉 **تفضل يا ${message.author}، تم تخطي الرابط بنجاح!**`,
                                    embeds: [embed],
                                    components: [row]
                                }).catch(() => {});
                            }
                        } else {
                            const embed = new EmbedBuilder()
                                .setColor('#ff4d4d') // Red
                                .setTitle('الرابط غير صالح أو منتهي الصلاحية <:No:1516534087161221233>')
                                .setDescription('هذا الرابط قد انتهى أو تم تعديله ليصبح غير صالح.')
                                .setFooter({ text: `Requested by ${message.author.username} | Done in ${timeTaken}s`, iconURL: message.author.displayAvatarURL({ dynamic: true }) });

                            if (replyMsg) {
                                await replyMsg.edit({
                                    content: `❌ **عذراً ${message.author}، لم نتمكن من تخطي هذا الرابط.**`,
                                    embeds: [embed],
                                    components: []
                                }).catch(() => {});
                            } else {
                                await message.channel.send({
                                    content: `❌ **عذراً ${message.author}، لم نتمكن من تخطي هذا الرابط.**`,
                                    embeds: [embed],
                                    components: []
                                }).catch(() => {});
                            }
                        }
                    } catch (apiError) {
                        console.error('[Delta Auto-Bypass fetch exception]:', apiError);
                        const timeTaken = ((Date.now() - startTime) / 1000).toFixed(0);
                        const embed = new EmbedBuilder()
                            .setColor('#ff4d4d') // Red
                            .setTitle('خطأ أثناء التخطي <:No:1516534087161221233>')
                            .setDescription('واجهنا خطأ فني أثناء محاولة تخطي هذا الرابط.')
                            .setFooter({ text: `Requested by ${message.author.username} | Done in ${timeTaken}s`, iconURL: message.author.displayAvatarURL({ dynamic: true }) });

                        if (replyMsg) {
                            await replyMsg.edit({
                                content: `❌ **عذراً ${message.author}، حدث خطأ فني أثناء التخطي.**`,
                                embeds: [embed],
                                components: []
                            }).catch(() => {});
                        } else {
                            await message.channel.send({
                                content: `❌ **عذراً ${message.author}، حدث خطأ فني أثناء التخطي.**`,
                                embeds: [embed],
                                components: []
                            }).catch(() => {});
                        }
                    }
                    return; // إنهاء الإجراء لعدم تنفيذ باقي مستمعي الرسائل
                }
            }
        }
    }

    // AI Avatar Image Upload Handler
    if (state && state.type === 'ai_upload_avatar') {
        const att = message.attachments.first();
        if (!att || !att.contentType?.startsWith('image/')) {
            return message.reply('❌ يرجى إرسال صورة صالحة كملف مرفق.').then(m => setTimeout(() => m.delete().catch(()=>{}), 5000));
        }
        
        const finalUrl = await saveAttachmentPermanently(message.guild, att);
        
        // Update the db
        db[message.guildId].ai.avatar = finalUrl;
        saveDB(db);
        
        await message.delete().catch(() => {});
        activeStates.delete(message.author.id);
        
        const successMsg = await message.channel.send('✅ **تم تحديث صورة الذكاء الاصطناعي بنجاح!**');
        setTimeout(() => successMsg.delete().catch(() => {}), 5000);
        
        // Edit the main panel if we can!
        try {
            const channel = client.channels.cache.get(state.channelId);
            if (channel) {
                const originalMsg = await channel.messages.fetch(state.messageId).catch(() => null);
                if (originalMsg) {
                    const newEmbed = EmbedBuilder.from(originalMsg.embeds[0])
                        .setDescription(
                            `**اسم الذكاء الاصطناعي <:Ai:1521447887756722196> :** ${db[message.guildId].ai.name}\n` +
                            `-#  ~~                                                                                                                                                                  ~~\n` +
                            `**صورة الذكاء الاصطناعي <:Photo:1516575747425439975> :** [انقر لعرض الصورة](${finalUrl})\n` +
                            `-#  ~~                                                                                                                                                                  ~~\n` +
                                    `**حالة الذكاء الاصطناعي <:Status:1521447885412237364> :** ${db[message.guildId].ai.status}\n` +
                                    `-#  ~~                                                                                                                                                                  ~~\n` +
                                    `**روم الكلام مع الـai <:Hastag:1516365641823551528> :** ${db[message.guildId].ai.channelId ? `<#${db[message.guildId].ai.channelId}>` : 'غير محدد'}\n` +
                                    `-#  ~~                                                                                                                                                                  ~~\n` +
                                    `**كاتاجوري المساعد 📁 :** ${db[message.guildId].ai.categoryId ? `<#${db[message.guildId].ai.categoryId}>` : 'غير محدد'}\n` +
                                    `-#  ~~                                                                                                                                                                  ~~\n` +
                                    `**نوع التدريب <:training:1521452247270293524> :** ${db[message.guildId].ai.trainingType === 'auto' ? 'تدريب تلقائي (نفسه)' : (db[message.guildId].ai.trainingType === 'manual' ? 'تدريب يدوي' : 'غير محدد')}`
                                );
                    await originalMsg.edit({ embeds: [newEmbed] }).catch(() => {});
                }
            }
        } catch (e) {
            console.error('Error updating main AI message on image upload:', e);
        }
        return;
    }

    const protectLink = db[message.guildId]?.protection?.links;
    if (protectLink && protectLink.enabled && message.author.id !== message.guild.ownerId && !message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
        if (/(https?:\/\/[^\s]+|:\/\/[^\s]+)/gi.test(message.content)) {
            await message.delete().catch(() => {});
            const msg = await message.channel.send(`⚠️ | ${message.author} يمنع إرسال الروابط حفاظاً على أمن السيرفر!`);
            setTimeout(() => msg.delete().catch(() => {}), 5000);
            await applyPunishment(message.guild, message.author, protectLink, 'إرسال رابط غير مسموح به', message.content.substring(0, 50));
            return;
        }
    }
    const protectSpam = db[message.guildId]?.protection?.spam;
    if (protectSpam && protectSpam.enabled && message.author.id !== message.guild.ownerId) {
        const now = Date.now();
        if (!userMessageCache.has(message.author.id)) userMessageCache.set(message.author.id, []);
        const cache = userMessageCache.get(message.author.id);
        cache.push({ id: message.id, time: now });
        const recent = cache.filter(m => now - m.time < 3000);
        userMessageCache.set(message.author.id, recent);
        if (recent.length >= 3) {
            const ids = recent.map(m => m.id);
            try { await message.channel.bulkDelete(ids).catch(async () => { for (const id of ids) { const m = await message.channel.messages.fetch(id).catch(() => null); if (m) await m.delete().catch(()=>{}); } }); } catch(e){}
            const warn = await message.channel.send(`⚠️ | ${message.author} يمنع السبام نهائياً! تم كتمك لحماية الشات.`);
            setTimeout(() => warn.delete().catch(() => {}), 5000);
            await applyPunishment(message.guild, message.author, protectSpam, 'سبام مفرط', 'إرسال رسائل متعددة بسرعة عالية');
            return;
        }
    }

    // AI Conversation Interceptor
    const aiConfig = db[message.guildId]?.ai;
    if (aiConfig && aiConfig.status === 'متصل') {
        const validChannelId = (aiConfig.channelId && /^\d+$/.test(aiConfig.channelId)) ? aiConfig.channelId : null;
        const validCategoryId = (aiConfig.categoryId && /^\d+$/.test(aiConfig.categoryId)) ? aiConfig.categoryId : null;

        const inAIChannel = (validChannelId && message.channelId === validChannelId);
        const inAICategory = (validCategoryId && message.channel.parentId === validCategoryId);
        const isBotMentioned = message.mentions.users.has(client.user.id);
        const isInsulted = hasSwearWords(message.content);

        // Check if it's a reply to the bot
        let isReplyToBot = false;
        if (message.reference && message.reference.messageId) {
            try {
                const repliedMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
                if (repliedMsg && repliedMsg.author.id === client.user.id) {
                    isReplyToBot = true;
                }
            } catch (e) {}
        }

        let shouldRespond = false;
        if (validChannelId || validCategoryId) {
            // If a specific room or category is configured, the bot should only respond inside them.
            if (inAIChannel) {
                // Inside the dedicated AI channel, respond to every message
                shouldRespond = true;
            } else if (inAICategory) {
                // Inside the AI category, ONLY respond if the bot is explicitly mentioned or replied to
                if (isBotMentioned || isReplyToBot) {
                    shouldRespond = true;
                }
            }
        } else {
            // If neither is configured, the bot should NOT respond to prevent talking in all rooms.
            // Administrator must configure an AI channel or category first via /ai.
            shouldRespond = false;
        }

        if (shouldRespond) {
            // Trigger typing indicator
            await message.channel.sendTyping().catch(() => {});

            let userPrompt = message.content;
            if (isBotMentioned) {
                userPrompt = userPrompt.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
            }

            // Fetch last 12 messages from the channel for conversation context
            let promptToUse = userPrompt;
            try {
                const recentMessages = await message.channel.messages.fetch({ limit: 12 }).catch(() => null);
                if (recentMessages && recentMessages.size > 0) {
                    // Reverse to chronological order (oldest first)
                    const sorted = Array.from(recentMessages.values()).reverse();
                    let chatHistoryText = "آخر دردشة في هذا الروم لفهم السياق العام وفكرة السيرفر:\n";
                    sorted.forEach(m => {
                        if (m.author.bot && m.author.id !== client.user.id) return; // Skip other bots
                        const senderName = m.author.id === client.user.id ? `أنت (${client.user.username})` : m.author.username;
                        const cleanMsg = m.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
                        if (cleanMsg) {
                            chatHistoryText += `- ${senderName}: ${cleanMsg}\n`;
                        }
                    });
                    chatHistoryText += `\nالآن أجب باختصار وعفوية على الرسالة الجديدة من العضو ${message.author.username} (إذا أردت منشنته أو الإشارة إليه، استخدم الكود الخاص به فوراً: <@${message.author.id}>): ${userPrompt}`;
                    promptToUse = chatHistoryText;
                }
            } catch (err) {
                console.error("Failed to build chat history context:", err);
            }

            try {
                const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
                const systemPrompt = buildAISystemPrompt(message.guild, aiConfig, isAdmin, isInsulted);
                const rawResponse = await callGroqAPI(systemPrompt, promptToUse);

                let cleanResponse = rawResponse;

                // Parse and strip reactions
                const reactionsToApply = [];
                const reactionRegex = /\[REACTION:\s*([^\]]+)\]/g;
                let rMatch;
                while ((rMatch = reactionRegex.exec(rawResponse)) !== null) {
                    reactionsToApply.push(rMatch[1].trim());
                }
                cleanResponse = cleanResponse.replace(reactionRegex, '').trim();

                // Parse and strip actions
                const actions = [];
                const actionRegex = /\[ACTION:\s*([^\]]+)\]/g;
                let match;
                while ((match = actionRegex.exec(rawResponse)) !== null) {
                    actions.push(match[1].trim());
                }
                cleanResponse = cleanResponse.replace(actionRegex, '').trim();

                // Clean up incomplete/broken custom Discord emojis (e.g. <:info:12345 or <:info or <: or <a: or unclosed brackets)
                cleanResponse = cleanResponse.replace(/<a?:\w+(?::\d+)?(?!>)/g, '');
                cleanResponse = cleanResponse.replace(/<a?:\w*$/g, '');
                cleanResponse = cleanResponse.replace(/<a?::\d+>/g, '');
                cleanResponse = cleanResponse.replace(/<:\w+:\s*>/g, '');

                if (cleanResponse) {
                    await sendAIResponse(message, cleanResponse, aiConfig);
                }

                // Apply any parsed reactions on the user's message (only 50% of the time to keep it natural and avoid spam)
                if (reactionsToApply.length > 0 && Math.random() < 0.5) {
                    for (const react of reactionsToApply) {
                        try {
                            let emojiToReact = react;
                            if (react.includes(':')) {
                                const idMatch = react.match(/:(\d+)>/);
                                if (idMatch) emojiToReact = idMatch[1];
                            } else {
                                const foundEmoji = message.guild.emojis.cache.find(e => e.name === react || e.id === react);
                                if (foundEmoji) emojiToReact = foundEmoji.id;
                            }
                            await message.react(emojiToReact).catch(() => {});
                        } catch (reactErr) {
                            console.error('Failed to react to message:', reactErr);
                        }
                    }
                }

                // Process actions only if user is Admin
                if (isAdmin) {
                    for (const action of actions) {
                        try {
                            console.log(`[AI ACTION EXECUTED]: ${action}`);
                            if (action === 'HIDE_CHANNEL') {
                                const everyone = message.guild.roles.everyone;
                                await message.channel.permissionOverwrites.edit(everyone, { ViewChannel: false }).catch(console.error);
                            } else if (action.startsWith('GIVE_ROLE')) {
                                const uMatch = action.match(/user:\s*["']?(\d+)["']?/);
                                const rMatch = action.match(/role:\s*["']?(\d+)["']?/);
                                if (uMatch && rMatch) {
                                    const targetUser = uMatch[1];
                                    const targetRole = rMatch[1];
                                    const member = await message.guild.members.fetch(targetUser).catch(() => null);
                                    const role = message.guild.roles.cache.get(targetRole);
                                    if (member && role) {
                                        await member.roles.add(role).catch(console.error);
                                    }
                                }
                            } else if (action.startsWith('REMOVE_ROLE')) {
                                const uMatch = action.match(/user:\s*["']?(\d+)["']?/);
                                const rMatch = action.match(/role:\s*["']?(\d+)["']?/);
                                if (uMatch && rMatch) {
                                    const targetUser = uMatch[1];
                                    const targetRole = rMatch[1];
                                    const member = await message.guild.members.fetch(targetUser).catch(() => null);
                                    const role = message.guild.roles.cache.get(targetRole);
                                    if (member && role) {
                                        await member.roles.remove(role).catch(console.error);
                                    }
                                }
                            } else if (action.startsWith('CREATE_CHANNEL')) {
                                const nMatch = action.match(/name:\s*["']?([^"']+)["']?/);
                                if (nMatch) {
                                    const chName = nMatch[1];
                                    await message.guild.channels.create({ name: chName, type: ChannelType.GuildText }).catch(console.error);
                                }
                            } else if (action.startsWith('DELETE_CHANNEL')) {
                                const nMatch = action.match(/name:\s*["']?([^"']+)["']?/);
                                if (nMatch) {
                                    const chIdentifier = nMatch[1];
                                    const targetChannel = message.guild.channels.cache.find(c => c.name === chIdentifier || c.id === chIdentifier);
                                    if (targetChannel) await targetChannel.delete().catch(console.error);
                                }
                            } else if (action.startsWith('CREATE_ROLE')) {
                                const nMatch = action.match(/name:\s*["']?([^"']+)["']?/);
                                if (nMatch) {
                                    const rName = nMatch[1];
                                    await message.guild.roles.create({ name: rName }).catch(console.error);
                                }
                            } else if (action.startsWith('DELETE_ROLE')) {
                                const nMatch = action.match(/name:\s*["']?([^"']+)["']?/);
                                if (nMatch) {
                                    const rIdentifier = nMatch[1];
                                    const targetRole = message.guild.roles.cache.find(r => r.name === rIdentifier || r.id === rIdentifier);
                                    if (targetRole) await targetRole.delete().catch(console.error);
                                }
                            } else if (action.startsWith('LEARN')) {
                                const ruleMatch = action.match(/rule:\s*["']?([^"']+)["']?/);
                                if (ruleMatch) {
                                    const rule = ruleMatch[1];
                                    if (!aiConfig.knowledge) aiConfig.knowledge = [];
                                    aiConfig.knowledge.push(rule);
                                    db[message.guildId].ai.knowledge = aiConfig.knowledge;
                                    saveDB(db);
                                    console.log(`[AI LEARNING]: Saved new rule: "${rule}"`);
                                }
                            }
                        } catch (actErr) {
                            console.error('Error executing parsed AI action:', actErr);
                        }
                    }
                } else if (actions.length > 0) {
                    console.log(`[AI SECURITY BLOCKED]: Non-admin user tried to trigger actions: ${actions.join(', ')}`);
                }
            } catch (aiErr) {
                console.error('[AI Chat Exception]:', aiErr);
                await message.reply('⚠️ عذراً، واجهت مشكلة في الاتصال بسيرفرات الذكاء الاصطناعي حالياً.').catch(() => {});
            }
            return;
        }
    }

    if (!state) return;
    const panel = db[message.guildId]?.panels?.[state.panelId];
    if (!panel) { activeStates.delete(message.author.id); return; }
    if (state.type === 'upload_image') {
        const att = message.attachments.first();
        if (!att) return message.reply('❌ يرجى إرسال صورة صالحة كملف مرفق.').then(m => setTimeout(() => m.delete().catch(()=>{}), 5000));
        const savedUrl = await saveAttachmentPermanently(message.guild, att);
        if (state.imgType === 'welcome') panel.welcome_img = savedUrl;
        else panel.img = savedUrl;
        saveDB(db);
        await message.delete().catch(() => {});
        activeStates.delete(message.author.id);
        const success = await message.channel.send('✅ تم إضافة الصورة بنجاح!');
        setTimeout(() => success.delete().catch(() => {}), 3000);
        await updatePanelEmbed({ guildId: message.guildId, editReply: d => message.channel.send(d), replied: true }, state.panelId);
    }
    if (state.type === 'upload_emoji') {
        const content = message.content.trim(), match = content.match(/<?(?:a)?:(?<name>\w+):(?<id>\d+)>/);
        let val = match ? match[2] : content;
        if (!panel.buttons) panel.buttons = [];
        panel.buttons.push({ name: state.btnName, category: null, emoji: val });
        saveDB(db);
        await message.delete().catch(() => {});
        activeStates.delete(message.author.id);
        const success = await message.channel.send(`✅ تم إضافة الزر **"${state.btnName}"** مع الإيموجي بنجاح!`);
        setTimeout(() => success.delete().catch(() => {}), 3000);
        await updatePanelEmbed({ guildId: message.guildId, editReply: d => message.channel.send(d), replied: true }, state.panelId);
    }
});

client.on('interactionCreate', async interaction => {
    const isTranscriptRelated = interaction.customId && interaction.customId.startsWith('view_transcript_');
    const isDeltaRelated = (interaction.isChatInputCommand() && interaction.commandName === 'delta') || 
                           (interaction.customId && (interaction.customId === 'toggle_bypass_btn' || interaction.customId.startsWith('bypass_') || interaction.customId.startsWith('modal_bypass_')));

    // Check if bot is present in the guild (if guildId is present)
    const botInGuild = interaction.guildId ? interaction.client.guilds.cache.has(interaction.guildId) : false;

    if (interaction.guildId) {
        if (!botInGuild && !isDeltaRelated) {
            return interaction.reply({
                content: '❌ **البوت غير متواجد في هذا السيرفر!** يرجى دعوة البوت أولاً للتمكن من استخدام ميزاته وأوامره.',
                ephemeral: true
            });
        }
    } else {
        // No guildId (e.g. DM or user-installed outside guild)
        if (!isDeltaRelated && !isTranscriptRelated) {
            return interaction.reply({
                content: '❌ **لا يمكن استخدام هذا الأمر هنا!** هذا الأمر يتطلب وجود البوت في سيرفر ديسكورد.',
                ephemeral: true
            });
        }
    }

    if (interaction.guildId && botInGuild) {
        ensureGuildData(interaction.guildId);
    }
    const db = getDB();

    // Helper to check for admin-only button/menu/modal interactions
    const checkIsAdminInteraction = (inter) => {
        const customId = inter.customId;
        if (!customId) return false;
        
        if (customId === 'publish_suggestion_prompt_btn' || customId === 'submit_suggestion_modal') {
            return false;
        }
        if (customId.startsWith('open_ticket_') || 
            customId.startsWith('ticket_panel_btn_') ||
            customId.startsWith('ticket_panel_select_') ||
            customId.startsWith('claim_') || 
            customId.startsWith('reclaim_') || 
            customId.startsWith('delete_req_') || 
            customId.startsWith('del_confirm_') || 
            customId === 'del_cancel' ||
            customId.startsWith('rename_modal_') ||
            customId.startsWith('ticket_mgmt_') ||
            customId.startsWith('view_transcript_') ||
            customId.startsWith('ticket_actions_') ||
            customId.startsWith('add_member_to_') ||
            customId.startsWith('remove_member_from_')) {
            return false;
        }
        if (customId.startsWith('music_pause_') || customId.startsWith('music_next_') || customId.startsWith('music_prev_')) {
            return false;
        }
        return customId === 'main_setup_menu' ||
               customId === 'modal_create_panel_init' ||
               customId.startsWith('ai_') ||
               customId.startsWith('edit_panel_') ||
               customId.startsWith('set_display_') ||
               customId.startsWith('edit_texts_') ||
               customId.startsWith('edit_roles_') ||
               customId.startsWith('edit_images_') ||
               customId.startsWith('set_img_type_') ||
               customId.startsWith('save_img_src_') ||
               customId.startsWith('edit_buttons_') ||
               customId.startsWith('btn_opt_') ||
               customId.startsWith('btn_emoji_choice_') ||
               customId.startsWith('select_btn_') ||
               customId.startsWith('send_panel_') ||
               customId.startsWith('modal_panel_') ||
               customId.startsWith('modal_edit_texts_') ||
               customId.startsWith('modal_add_btn_name_') ||
               customId.startsWith('protect_') ||
               customId.startsWith('set_punishment_') ||
               customId.startsWith('modal_timeout_duration_') ||
               customId === 'select_violation_detailed';
    };

    // Block non-admins from admin interactions (Buttons, select menus, modal submits)
    if (checkIsAdminInteraction(interaction)) {
        if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ هذه الإجراءات مخصصة للمسؤولين فقط (Administrator).', ephemeral: true });
        }
    }

    // نظام منع العبث بالأزرار عشوائياً (Throttling / Interaction Cooldown)
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const isProtect = interaction.customId.startsWith('protect_') || interaction.customId.startsWith('set_punishment_') || interaction.customId.startsWith('modal_timeout_duration_') || interaction.customId === 'select_violation_detailed';
        if (isProtect && interaction.guild.ownerId !== interaction.user.id) {
            return interaction.reply({ content: '❌ هذه الإجراءات مخصصة حصرياً لمالك السيرفر (Owner).', ephemeral: true });
        }

        // تطبيق ليميت وتباطؤ في الرد لحماية البوت من التعطل
        const now = Date.now();
        const cooldownTime = 1500; // ثانيتان كحد أقصى بين الضغطات المتتالية
        const userCooldown = interactionCooldowns.get(interaction.user.id);
        if (userCooldown && (now - userCooldown < cooldownTime)) {
            return interaction.reply({
                content: '⚠️ **يرجى عدم العبث بالبوت والضغط على الأزرار بشكل متكرر وسريع!** تم إبطاء الاستجابة لحماية النظام من التشنج والتعطل.',
                ephemeral: true
            });
        }
        interactionCooldowns.set(interaction.user.id, now);
    }

    if (interaction.isChatInputCommand()) {
        // Enforce Administrator check for admin slash commands
        const adminCommands = ['setup_ticket', 'setup_azkar', 'setup_suggestion', 'protection', 'music', 'ai', 'key'];
        if (adminCommands.includes(interaction.commandName)) {
            if (interaction.commandName === 'protection') {
                if (interaction.guild.ownerId !== interaction.user.id) {
                    return interaction.reply({ content: '❌ هذا الأمر مخصص لمالك السيرفر فقط.', ephemeral: true });
                }
            } else if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ هذا الأمر مخصص للمسؤولين فقط (Administrator).', ephemeral: true });
            }
        }
        if (interaction.commandName === 'setup_ticket') {
            const isEphem = interaction.options.getBoolean('ephemeral') ?? true;
            const menu = new StringSelectMenuBuilder().setCustomId('main_setup_menu').setPlaceholder('اختر من القائمة المنسدلة...')
                .addOptions(
                    { label: 'انشاء بانل', value: 'create_panel', emoji: { id: '1516365643379773490' } },
                    { label: 'اعدادات البانل', value: 'panel_settings', emoji: { id: '1516395313752182914' } }
                );
            await interaction.reply({ content: '**اعدادات التكت يمكنك تسطيب التكت من الازرار <a:Gear:1516391965422387380>**', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: isEphem });
        }
        if (interaction.commandName === 'setup_azkar') {
            const channel = interaction.options.getChannel('channel'), interval = parseInt(interaction.options.getString('interval')), role = interaction.options.getRole('role');
            if (!db[interaction.guildId]) db[interaction.guildId] = {};
            db[interaction.guildId].azkar = { channelId: channel.id, interval, roleId: role ? role.id : null };
            saveDB(db);
            startAzkarScheduler(interaction.guildId, channel.id, interval, role ? role.id : null);
            await interaction.reply({ content: `**<:Yea:1516534090751279257> | تم تسطيب الأذكار بنجاح**`, ephemeral: true });
        }
        if (interaction.commandName === 'setup_suggestion') {
            const ch = interaction.options.getChannel('channel'), title = interaction.options.getString('title'), desc = interaction.options.getString('description'), url = interaction.options.getString('image_url'), useIcon = interaction.options.getBoolean('use_server_icon') ?? false;
            db[interaction.guildId].suggestions = { channelId: ch.id, title, description: desc, imageUrl: url, useServerIcon: useIcon };
            saveDB(db);
            const em = new EmbedBuilder().setColor('#12a524').setTitle(title).setDescription(desc);
            if (url) em.setImage(url);
            else if (useIcon) { const icon = interaction.guild.iconURL({ size: 1024 }); if (icon) em.setImage(icon); }
            const r = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('publish_suggestion_prompt_btn').setLabel('نشر إقتراح').setEmoji('1517591602049056829').setStyle(ButtonStyle.Success));
            await ch.send({ embeds: [em], components: [r] });
            await interaction.reply({ content: '✅ تم إنشاء لوحة نظام الاقتراحات بنجاح!', ephemeral: true });
        }
        if (interaction.commandName === 'protection') {
            if (interaction.guild.ownerId !== interaction.user.id) return interaction.reply({ content: '❌ هذا الأمر مخصص لمالك السيرفر فقط.', ephemeral: true });
            const isEphem = interaction.options.getBoolean('ephemeral') ?? false;
            const data = getProtectionEmbedAndComponents(interaction.guildId);
            const reply = await interaction.reply({ ...data, ephemeral: isEphem, fetchReply: true });
            if (!isEphem) { db[interaction.guildId].protectionMessageId = reply.id; saveDB(db); }
        }
        if (interaction.commandName === 'music') {
            const status = interaction.options.getString('status');
            db[interaction.guildId].musicEnabled = (status === 'enable');
            saveDB(db);
            const text = status === 'enable' ? 'تفعيل' : 'تعطيل';
            return interaction.reply({ content: `**<:Music:1520205276311982131> | تم ${text} الاغاني بنجاح**` });
        }
        if (interaction.commandName === 'play') {
            if (!db[interaction.guildId].musicEnabled) {
                return interaction.reply({ content: '❌ نظام الأغاني معطل حالياً في هذا السيرفر.', ephemeral: true });
            }

            const voiceChannel = interaction.member?.voice?.channel;
            if (!voiceChannel) return interaction.reply({ content: '❌ يجب أن تكون في روم صوتي أولاً!', ephemeral: true });

            const search = interaction.options.getString('song');
            if (!search) return interaction.reply({ content: '❌ يرجى كتابة اسم الأغنية أو الرابط!', ephemeral: true });

            await interaction.deferReply();

            try {
                const kazagumo = getKazagumo();
                
                // ليميت لوضع الأغاني: أقصى حد 5 أغاني في قائمة الانتظار
                const existingPlayer = kazagumo.players.get(interaction.guildId);
                if (existingPlayer && existingPlayer.queue.length >= 5) {
                    return interaction.editReply({ content: '❌ **لا يمكن إضافة الأغنية! لقد بلغت الحد الأقصى المسموح به (5 أغاني فقط في قائمة الانتظار).**' });
                }

                let result = null;

                // 1. Check if player already exists
                if (existingPlayer) {
                    try {
                        result = await kazagumo.search(search, { requester: interaction.user, nodeName: existingPlayer.node.name });
                    } catch (e) {
                        console.error(`⚠️ Search failed on existing player's node (${existingPlayer.node.name}):`, e.message || e);
                    }
                }

                // 2. If no existing player OR search failed on the existing player's node:
                if (!result || !result.tracks.length) {
                    const allNodes = Array.from(kazagumo.shoukaku.nodes.values());
                    const readyNodesList = allNodes.filter(n => n.state === 2 || n.state === 'CONNECTED');
                    const nodesToTry = readyNodesList.length > 0 ? readyNodesList : allNodes;
                    
                    let lastError = null;
                    for (const node of nodesToTry) {
                        const nodeName = node.name;
                        try {
                            console.log(`⏳ [MUSIC SEARCH FAILOVER] Attempting search on node [${nodeName}]...`);
                            const tempResult = await kazagumo.search(search, { requester: interaction.user, nodeName: nodeName });
                            if (tempResult && tempResult.tracks.length) {
                                result = tempResult;
                                break;
                            }
                        } catch (err) {
                            console.error(`❌ [MUSIC SEARCH FAILOVER] Failed search on node [${nodeName}]:`, err.message || err);
                            lastError = err;
                        }
                    }
                    
                    if (!result || !result.tracks.length) {
                        throw lastError || new Error("All configured music nodes failed to respond or search returned no results.");
                    }
                }

                const tracks = result.tracks.slice(0, 10);
                if (tracks.length === 0) {
                    return interaction.editReply({ content: '❌ لم يتم العثور على أي نتائج بحث متطابقة.' });
                }

                // Cache search results
                const cacheId = `${interaction.user.id}_${Date.now()}`;
                playSearchCache.set(cacheId, {
                    tracks: tracks,
                    voiceChannelId: voiceChannel.id,
                    textChannelId: interaction.channelId,
                    timestamp: Date.now()
                });

                // Auto-delete from cache after 5 minutes
                setTimeout(() => playSearchCache.delete(cacheId), 5 * 60 * 1000);

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`play_select_${cacheId}`)
                    .setPlaceholder('🎶 اختر الأغنية التي تريد تشغيلها...')
                    .addOptions(
                        tracks.map((t, idx) => ({
                            label: (t.title || 'Unknown').slice(0, 100),
                            description: (t.author || 'Unknown').slice(0, 100),
                            value: idx.toString()
                        }))
                    );

                const row = new ActionRowBuilder().addComponents(selectMenu);

                await interaction.editReply({
                    content: `🔍 **نتائج البحث عن:** \`${search}\`\nالرجاء اختيار الأغنية من القائمة أدناه:`,
                    components: [row]
                });

            } catch (error) {
                console.error(error);
                if (error && error.message && error.message.includes('All configured music nodes failed to respond')) {
                    await interaction.editReply({ content: '⚠️ **واجهنا مشكلة في الاتصال بسيرفرات الموسيقى (لافالينك). جاري إعادة تشغيل البوت تلقائياً لحل المشكلة وتنشيط الاتصال... يرجى المحاولة بعد 10 ثوانٍ.**' });
                    console.log('⚠️ [Music Auto-Restart] Initiating process exit for auto-restart...');
                    setTimeout(() => {
                        process.exit(1);
                    }, 2000);
                } else {
                    await interaction.editReply({ content: '❌ لم يتم العثور على أي نتائج أو فشل في الاتصال بسيرفر لافالينك.' });
                }
            }
        }

        if (interaction.commandName === 'delta') {
            const deltaLink = interaction.options.getString('link');
            const botInGuild = interaction.guildId ? interaction.client.guilds.cache.has(interaction.guildId) : false;

            if (botInGuild) {
                if (!db[interaction.guildId]) db[interaction.guildId] = {};
                const keyConfig = db[interaction.guildId].deltaKeys;

                if (!keyConfig || !keyConfig.enabled) {
                    return interaction.reply({ content: '❌ **عذراً، نظام المفاتيح غير مفعل في هذا السيرفر.**', ephemeral: true });
                }

                if (interaction.channelId !== keyConfig.channelId) {
                    return interaction.reply({ content: `❌ **عذراً، يرجى استخدام هذا الأمر فقط في الروم المخصص: <#${keyConfig.channelId}>**`, ephemeral: true });
                }

                if (keyConfig.method === 'link') {
                    return interaction.reply({ content: `❌ **عذراً، نظام المفاتيح في هذا السيرفر مضبوط على "إرسال رابط فقط". يرجى إرسال الرابط مباشرة في الشات دون استخدام أمر \`/delta\`!**`, ephemeral: true });
                }
            }

            const isDeltaLink = deltaLink.includes('platoboost') || deltaLink.includes('platorelay') || deltaLink.includes('delta-executor') || deltaLink.includes('delta');
            if (!isDeltaLink) {
                const container = new ContainerBuilder()
                    .setAccentColor(0xff4d4d) // Red
                    .addTextDisplayComponents((textDisplay) =>
                        textDisplay.setContent(
                            `### Unsupported link <:No:1516534087161221233>\n` +
                            `-#  ~~                                                                                                                                                                   ~~\n` +
                            `This link is not for Delta execute.\n` +
                            `-#  ~~                                                                                                                                                                   ~~`
                        )
                    );
                return interaction.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            const startTime = Date.now();

            const loadingContainer = new ContainerBuilder()
                .setAccentColor(0x2b2d31)
                .addTextDisplayComponents((textDisplay) =>
                    textDisplay.setContent(
                        `### extraction Extracting your key <a:Reset:1516390093504385074>`
                    )
                );

            await interaction.reply({
                components: [loadingContainer],
                flags: MessageFlags.IsComponentsV2
            });

            try {
                const response = await fetch('https://api-bypassers.onrender.com/api/bypass', {
                    method: 'POST',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                        'X-API-Key': 'freeApikey',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ url: deltaLink })
                });

                let bypassedLink = null;
                let isExpiredOrInvalid = false;

                if (response.ok) {
                    const data = await response.json();
                    console.log('[Delta Bypass API Success]:', data);
                    if (data.bypassed || data.result || data.key || (data.success && typeof data.success === 'string')) {
                        bypassedLink = data.bypassed || data.result || data.key || data.success;
                    } else if (data.success === false || data.error) {
                        isExpiredOrInvalid = true;
                    }
                } else {
                    console.error('[Delta Bypass API Fail Status]:', response.status);
                    isExpiredOrInvalid = true;
                }

                const timeTaken = ((Date.now() - startTime) / 1000).toFixed(0);

                if (bypassedLink) {
                    const container = new ContainerBuilder()
                        .setAccentColor(0x57f287) // Green
                        .addTextDisplayComponents((textDisplay) =>
                            textDisplay.setContent(
                                `### Key bypassed <:Yea:1516534090751279257>\n` +
                                `-#  ~~                                                                                                                                                                   ~~\n` +
                                ` **Key for phone <:Phone:1521152101475160094>:\n` +
                                `\`${bypassedLink}\`\n` +
                                `-#  ~~                                                                                                                                                                   ~~\n` +
                                `Key for pc <:Pc:1521152784320434236>:\n` +
                                `\`\`\`${bypassedLink}\`\`\`**\n` +
                                `-#  ~~                                                                                                                                                                   ~~\n` +
                                `-# Request by ${interaction.user.username} - in ${timeTaken}s`
                            )
                        )
                        .addActionRowComponents((actionRow) =>
                            actionRow.setComponents(
                                new ButtonBuilder()
                                    .setEmoji('1511327391669026916')
                                    .setStyle(ButtonStyle.Link)
                                    .setURL('https://discord.gg/hBvzFrqQP2')
                            )
                        );
                    await interaction.editReply({
                        components: [container],
                        flags: MessageFlags.IsComponentsV2
                    });
                } else {
                    const container = new ContainerBuilder()
                        .setAccentColor(0xff4d4d) // Red
                        .addTextDisplayComponents((textDisplay) =>
                            textDisplay.setContent(
                                `### The link is expired or invalid <:No:1516534087161221233>\n` +
                                `This link has expired or has been modified to make it invalid.\n` +
                                `-#  ~~                                                                                                                                                                   ~~\n` +
                                `-# Request by ${interaction.user.username} - in ${timeTaken}s`
                            )
                        );
                    await interaction.editReply({
                        components: [container],
                        flags: MessageFlags.IsComponentsV2
                    });
                }
            } catch (apiError) {
                console.error('[Delta Bypass fetch exception]:', apiError);
                const timeTaken = ((Date.now() - startTime) / 1000).toFixed(0);
                const container = new ContainerBuilder()
                    .setAccentColor(0xff4d4d)
                    .addTextDisplayComponents((textDisplay) =>
                        textDisplay.setContent(
                            `### The link is expired or invalid <:No:1516534087161221233>\n` +
                            `This link has expired or has been modified to make it invalid.\n` +
                            `-#  ~~                                                                                                                                                                   ~~\n` +
                            `-# Request by ${interaction.user.username} - in ${timeTaken}s`
                        )
                    );
                await interaction.editReply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2
                });
            }
        }

        if (interaction.commandName === 'ai') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ هذا الأمر مخصص للإدارة فقط (Administrator).', ephemeral: true });
            }

            const isPremium = isGuildPremium(interaction.guildId);
            if (!isPremium) {
                const btn = new ButtonBuilder()
                    .setEmoji('1511327391669026916')
                    .setStyle(ButtonStyle.Link)
                    .setURL('https://discord.gg/hBvzFrqQP2');
                const row = new ActionRowBuilder().addComponents(btn);
                return interaction.reply({
                    content: `**<:Premium:1520486329316671689> | ليس لديك بريميوم للشراء توجه إلى الدعم**`,
                    components: [row],
                    ephemeral: true
                });
            }

            // Ensure guild has DB and AI config initialized
            if (!db[interaction.guildId]) db[interaction.guildId] = {};
            const aiData = db[interaction.guildId].ai || {
                name: 'غير محدد',
                avatar: 'غير محدد',
                status: 'غير متصل',
                channelId: null,
                categoryId: null,
                trainingType: null,
                knowledge: [],
                autoTrainedData: ''
            };
            db[interaction.guildId].ai = aiData;
            saveDB(db);

            const embed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('إعدادات الذكاء الاصطناعي')
                .setDescription(
                    `**اسم الذكاء الاصطناعي <:Ai:1521447887756722196> :** ${aiData.name}\n` +
                    `-#  ~~                                                                                                                                                                  ~~\n` +
                    `**صورة الذكاء الاصطناعي <:Photo:1516575747425439975> :** ${aiData.avatar === 'غير محدد' ? 'غير محدد' : `[انقر لعرض الصورة](${aiData.avatar})`}\n` +
                    `-#  ~~                                                                                                                                                                  ~~\n` +
                    `**حالة الذكاء الاصطناعي <:Status:1521447885412237364> :** ${aiData.status}\n` +
                    `-#  ~~                                                                                                                                                                  ~~\n` +
                    `**روم الكلام مع الـai <:Hastag:1516365641823551528> :** ${aiData.channelId ? `<#${aiData.channelId}>` : 'غير محدد'}\n` +
                    `-#  ~~                                                                                                                                                                  ~~\n` +
                    `**كاتاجوري المساعد 📁 :** ${aiData.categoryId ? `<#${aiData.categoryId}>` : 'غير محدد'}\n` +
                    `-#  ~~                                                                                                                                                                  ~~\n` +
                    `**نوع التدريب <:training:1521452247270293524> :** ${aiData.trainingType === 'auto' ? 'تدريب تلقائي (نفسه)' : (aiData.trainingType === 'manual' ? 'تدريب يدوي' : 'غير محدد')}`
                );

            const uId = interaction.user.id;
            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ai_set_name_${uId}`).setLabel('اسم الذكاء الاصطناعي').setEmoji('1516365639760085033').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`ai_set_avatar_${uId}`).setLabel('صورة الذكاء الاصطناعي').setEmoji('1516575747425439975').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`ai_set_status_${uId}`).setLabel('تعديل حالة الذكاء').setEmoji('1521449964591517807').setStyle(ButtonStyle.Secondary)
            );

            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ai_set_channel_${uId}`).setLabel('روم الكلام مع الـai').setEmoji('1516365641823551528').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`ai_set_category_${uId}`).setLabel('تحديد كاتاجوري').setEmoji('📁').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`ai_train_prompt_${uId}`).setLabel('تدريب الذكاء الاصطناعي').setEmoji('1521452247270293524').setStyle(ButtonStyle.Danger)
            );

            await interaction.reply({ embeds: [embed], components: [row1, row2] });
        }

        if (interaction.commandName === 'key') {
            const subcommand = interaction.options.getSubcommand();
            if (!db[interaction.guildId]) db[interaction.guildId] = {};

            if (subcommand === 'on') {
                const channel = interaction.options.getChannel('channel');
                const method = interaction.options.getString('method');
                db[interaction.guildId].deltaKeys = { enabled: true, channelId: channel.id, method: method };
                saveDB(db);

                let methodText = '';
                if (method === 'command') methodText = 'أمر /delta فقط';
                else if (method === 'link') methodText = 'إرسال رابط فقط (تخطي تلقائي)';
                else if (method === 'both') methodText = 'كليهما (الأمر وتخطي الروابط تلقائياً)';

                await interaction.reply({ content: `<:Yea:1516534090751279257> |** تم تفعيل نظام المفاتيح في روم <#${channel.id}> بطريقة: ${methodText}**` });
            } else if (subcommand === 'off') {
                db[interaction.guildId].deltaKeys = { enabled: false, channelId: null, method: null };
                saveDB(db);
                await interaction.reply({ content: `<:No:1516534087161221233> |** تم تعطيل نظام المفاتيح**` });
            }
        }

        if (interaction.commandName === 'support') {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'server') {
                const db = getDB();
                const supportServers = db.supportServers || [];

                const embed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle('السيرفرات الداعمة لهذا البوت:')
                    .setDescription(supportServers.length > 0 
                        ? 'اضغط على الأزرار أدناه للانضمام إلى السيرفرات الداعمة للبوت:' 
                        : 'لا توجد سيرفرات داعمة مسجلة حالياً.');

                const rows = [];
                if (supportServers.length > 0) {
                    let currentRow = new ActionRowBuilder();
                    supportServers.forEach((srv, index) => {
                        const btn = new ButtonBuilder()
                            .setStyle(ButtonStyle.Link)
                            .setURL(srv.inviteUrl)
                            .setLabel(`${srv.guildName} | ${srv.botName || client.user.username}`);

                        if (srv.emojiId) {
                            btn.setEmoji(srv.emojiId);
                        }

                        currentRow.addComponents(btn);

                        if (currentRow.components.length === 5 || index === supportServers.length - 1) {
                            rows.push(currentRow);
                            currentRow = new ActionRowBuilder();
                        }
                    });
                }

                await interaction.reply({
                    embeds: [embed],
                    components: rows,
                    ephemeral: true
                });
            }
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('play_select_')) {
        const cacheId = interaction.customId.split('_').slice(2).join('_');
        const cached = playSearchCache.get(cacheId);
        if (!cached) {
            return interaction.reply({ content: '❌ انتهت صلاحية قائمة البحث هذه. يرجى استخدام أمر `/play` مجدداً.', ephemeral: true });
        }

        const selectedIndex = parseInt(interaction.values[0]);
        const track = cached.tracks[selectedIndex];
        if (!track) {
            return interaction.reply({ content: '❌ حدث خطأ في اختيار الأغنية. يرجى المحاولة مجدداً.', ephemeral: true });
        }

        await interaction.deferReply();

        try {
            const kazagumo = getKazagumo();
            let player = kazagumo.players.get(interaction.guildId);

            if (!player) {
                const allNodes = Array.from(kazagumo.shoukaku.nodes.values());
                const readyNodesList = allNodes.filter(n => n.state === 2 || n.state === 'CONNECTED');
                const nodesToTry = readyNodesList.length > 0 ? readyNodesList : allNodes;

                let lastError = null;
                for (const node of nodesToTry) {
                    const nodeName = node.name;
                    try {
                        console.log(`⏳ [MUSIC FAILOVER] Creating player on node [${nodeName}]...`);
                        player = await kazagumo.createPlayer({
                            guildId: interaction.guildId,
                            voiceId: cached.voiceChannelId,
                            textId: cached.textChannelId,
                            deaf: false,
                            nodeName: nodeName
                        });
                        if (player) {
                            console.log(`✅ [MUSIC FAILOVER] Successfully created player on node [${nodeName}]`);
                            break;
                        }
                    } catch (err) {
                        console.error(`❌ [MUSIC FAILOVER] Failed creating player on node [${nodeName}]:`, err.message || err);
                        lastError = err;
                    }
                }

                if (!player) {
                    throw lastError || new Error("Failed to create player on any configured music node.");
                }
            }

            // check queue length
            if (player.queue.length >= 5) {
                return interaction.editReply({ content: '❌ **لا يمكن إضافة الأغنية! لقد بلغت الحد الأقصى المسموح به (5 أغاني فقط في قائمة الانتظار).**' });
            }

            player.queue.add(track);

            const gp = guildPlayers.get(interaction.guildId) || { history: [], activeMessage: null };
            guildPlayers.set(interaction.guildId, gp);

            if (player.playing || player.paused) {
                const payload = makePlayerEmbedAndButtons(interaction.guildId, player);
                if (payload) {
                    if (player.queue.length === 1) {
                        if (gp.activeMessage) {
                            try {
                                await gp.activeMessage.delete().catch(() => {});
                            } catch (e) {}
                        }
                        const msg = await interaction.channel.send(payload);
                        gp.activeMessage = msg;
                        guildPlayers.set(interaction.guildId, gp);
                    } else {
                        if (gp.activeMessage) {
                            try {
                                await gp.activeMessage.edit(payload).catch(() => {});
                            } catch (e) {}
                        } else {
                            const msg = await interaction.channel.send(payload);
                            gp.activeMessage = msg;
                            guildPlayers.set(interaction.guildId, gp);
                        }
                    }
                }
                const container = new ContainerBuilder()
                    .setAccentColor(0x57f287)
                    .addTextDisplayComponents((textDisplay) =>
                        textDisplay.setContent(`<:Spotify:1520459707691565096> | **${track.title}** مع **${track.author || 'Unknown'}**`)
                    );
                await interaction.editReply({
                    content: null,
                    embeds: [],
                    components: [container],
                    flags: MessageFlags.IsComponentsV2
                });
            } else {
                await player.play();
                const container = new ContainerBuilder()
                    .setAccentColor(0x57f287)
                    .addTextDisplayComponents((textDisplay) =>
                        textDisplay.setContent(`<:Spotify:1520459707691565096> | **${track.title}** مع **${track.author || 'Unknown'}**`)
                    );
                await interaction.editReply({
                    content: null,
                    embeds: [],
                    components: [container],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            // Remove the select menu from the original interaction so user cannot re-click it
            try {
                await interaction.message.edit({ components: [] }).catch(() => {});
            } catch (err) {}

            // Clean up cache for this query
            playSearchCache.delete(cacheId);

        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: '⚠️ عذراً، فشل تشغيل الأغنية أو الاتصال بسيرفر لافالينك حالياً.' });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'main_setup_menu') {
        const val = interaction.values[0];
        if (val === 'create_panel') {
            const modal = new ModalBuilder().setCustomId('modal_create_panel_init').setTitle('إنشاء بانل جديد');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('panel_id_input').setLabel('أيدي البانل (اسم بالإنجليزية، بدون مسافات)').setPlaceholder('support_panel').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('panel_name_input').setLabel('اسم البانل').setPlaceholder('الدعم الفني والشكاوى').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('panel_title_input').setLabel('عنوان إيمبد البانل').setPlaceholder('تذاكر الدعم الفني').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('panel_desc_input').setLabel('وصف إيمبد البانل').setPlaceholder('اضغط على أحد الأزرار لفتح تذكرة...').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('panel_welcome_input').setLabel('رسالة الترحيب بالتكت').setPlaceholder('أهلاً بك، يرجى كتابة استفسارك وسنجيبك قريباً.').setStyle(TextInputStyle.Paragraph).setRequired(true))
            );
            await interaction.showModal(modal);
        } else if (val === 'panel_settings') {
            const panels = db[interaction.guildId]?.panels || {};
            const keys = Object.keys(panels);
            if (keys.length === 0) return interaction.reply({ content: '❌ لا يوجد أي بانل متاح حالياً للتعديل. يرجى إنشاء واحد أولاً.', ephemeral: true });
            const sMenu = new StringSelectMenuBuilder().setCustomId('select_panel_to_edit').setPlaceholder('اختر البانل الذي تود تعديله...');
            keys.forEach(k => sMenu.addOptions({ label: panels[k].name || k, value: k, description: `تعديل البانل: ${k}` }));
            await interaction.reply({ content: '🛠️ **اختر البانل المطلوب لتعديله وضبطه:**', components: [new ActionRowBuilder().addComponents(sMenu)], ephemeral: true });
        }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_create_panel_init') {
        const pid = interaction.fields.getTextInputValue('panel_id_input').trim().replace(/\s+/g, '_').toLowerCase();
        const pname = interaction.fields.getTextInputValue('panel_name_input');
        const ptitle = interaction.fields.getTextInputValue('panel_title_input');
        const pdesc = interaction.fields.getTextInputValue('panel_desc_input');
        const pwelcome = interaction.fields.getTextInputValue('panel_welcome_input');
        if (!db[interaction.guildId].panels) db[interaction.guildId].panels = {};
        if (db[interaction.guildId].panels[pid]) return interaction.reply({ content: `❌ البانل \`${pid}\` موجود بالفعل!`, ephemeral: true });
        db[interaction.guildId].panels[pid] = { name: pname, title: ptitle, desc: pdesc, img: 'لايوجد', welcome_img: 'لايوجد', welcome: pwelcome, displayType: 'buttons', roles: [], buttons: [] };
        saveDB(db);
        await interaction.deferReply({ ephemeral: true });
        await updatePanelEmbed(interaction, pid);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_panel_to_edit') {
        const pid = interaction.values[0];
        await interaction.deferReply({ ephemeral: true });
        await updatePanelEmbed(interaction, pid);
    }

    if (interaction.isButton() && interaction.customId.startsWith('protect_manage_')) {
        const cat = interaction.customId.split('_')[2];
        const labels = { permissions: 'حماية الصلاحيات', roles: 'حماية الرتب', channels: 'حماية الرومات', bots: 'حماية من البوتات', links: 'حماية الروابط', spam: 'حماية السبام' };
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`protect_activate_${cat}`).setLabel('تفعيل').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`protect_deactivate_${cat}`).setLabel('تعطيل').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`protect_punish_select_${cat}`).setLabel('تحديد العقوبة').setStyle(ButtonStyle.Primary)
        );
        await interaction.reply({ content: `⚙️ **لوحة التحكم بـ ${labels[cat]}:**`, components: [row], ephemeral: true });
    }

    if (interaction.isButton() && (interaction.customId.startsWith('protect_activate_') || interaction.customId.startsWith('protect_deactivate_'))) {
        const act = interaction.customId.includes('protect_activate_'), cat = interaction.customId.split('_')[2];
        db[interaction.guildId].protection[cat].enabled = act; saveDB(db);
        const labels = { permissions: 'حماية الصلاحيات', roles: 'حماية الرتب', channels: 'حماية الرومات', bots: 'حماية البوتات', links: 'حماية الروابط', spam: 'حماية السبام' };
        const dMsgId = db[interaction.guildId].protectionMessageId;
        if (dMsgId) {
            const ch = interaction.channel;
            const msg = await ch.messages.fetch(dMsgId).catch(() => null);
            if (msg) { const data = getProtectionEmbedAndComponents(interaction.guildId); await msg.edit({ embeds: data.embeds, components: data.components }).catch(()=>{}); }
        }
        await interaction.reply({ content: `**${act ? '<:Yea:1516534090751279257>' : '<:No:1516534087161221233>'} | تم ${act ? 'تفعيل' : 'تعطيل'} ${labels[cat]} بنجاح!**`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId.startsWith('protect_punish_select_')) {
        const cat = interaction.customId.split('_')[3];
        const menu = new StringSelectMenuBuilder().setCustomId(`set_punishment_${cat}`).setPlaceholder('اختر نوع العقوبة لفرضه...')
            .addOptions([{ label: 'تايم اوت (Timeout)', value: 'timeout' }, { label: 'بان (Ban)', value: 'ban' }, { label: 'طرد (Kick)', value: 'kick' }]);
        await interaction.update({ content: '🚨 **اختر نوع العقوبة عند المخالفة:**', components: [new ActionRowBuilder().addComponents(menu)] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('set_punishment_')) {
        const cat = interaction.customId.split('_')[2], val = interaction.values[0];
        if (val === 'timeout') {
            const modal = new ModalBuilder().setCustomId(`modal_timeout_duration_${cat}`).setTitle('تحديد مدة التايم اوت');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration_input').setLabel('المدة الزمنية (مثل: 10m, 2h, 3d)').setStyle(TextInputStyle.Short).setRequired(true)));
            await interaction.showModal(modal);
        } else {
            db[interaction.guildId].protection[cat].punishment = val; saveDB(db);
            await interaction.update({ content: `✅ **تم تعيين عقوبة ${cat} إلى [${val}] بنجاح!**`, components: [] });
        }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_timeout_duration_')) {
        const cat = interaction.customId.split('_')[3], dur = interaction.fields.getTextInputValue('duration_input');
        db[interaction.guildId].protection[cat].punishment = 'timeout';
        db[interaction.guildId].protection[cat].punishmentDuration = dur; saveDB(db);
        await interaction.reply({ content: `✅ **تم تثبيت عقوبة التايم اوت لـ ${cat} لمدة [ ${dur} ] بنجاح!**`, ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId === 'protect_violations_list') {
        const violations = db[interaction.guildId].violations || [];
        if (violations.length === 0) return interaction.reply({ content: '❌ لا يوجد سجل للمخالفات حالياً.', ephemeral: true });
        const menu = new StringSelectMenuBuilder().setCustomId('select_violation_detailed').setPlaceholder('اختر مخالفة لعرض تفاصيلها...');
        violations.slice(0, 25).forEach(v => menu.addOptions({ label: `${v.username}: ${v.action}`, description: `الهدف: ${v.targetName}`, value: v.id }));
        await interaction.reply({ content: '📁 **اختر مخالفة لعرض كامل معلوماتها:**', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_violation_detailed') {
        const vid = interaction.values[0], list = db[interaction.guildId].violations || [], item = list.find(v => v.id === vid);
        if (!item) return interaction.reply({ content: '❌ لم يتم العثور على التفاصيل.', ephemeral: true });
        const em = new EmbedBuilder().setColor('Red').setTitle('⚠️ تفاصيل المخالفة والانتهاك')
            .addFields({ name: 'المخالف:', value: `<@${item.userId}> (${item.username})` }, { name: 'الأيدي (ID):', value: `\`${item.userId}\`` }, { name: 'المخالفة:', value: item.action }, { name: 'الهدف المتأثر:', value: item.targetName }, { name: 'عقوبة الدفاع الجوي:', value: item.punishmentTaken }, { name: 'التوقيت:', value: `<t:${Math.floor(item.timestamp / 1000)}:R>` });
        await interaction.reply({ embeds: [em], ephemeral: true });
    }

    // AI SYSTEM BUTTONS, SELECT MENUS, AND MODALS
    if (interaction.customId && interaction.customId.startsWith('ai_')) {
        // Authenticate administrator
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ هذا الأمر والأزرار مخصصة فقط لمشرفي السيرفر (Administrator).', ephemeral: true });
        }

        // Authenticate creator of the /ai message
        const parts = interaction.customId.split('_');
        const authorId = parts[parts.length - 1];
        if (authorId && authorId.length >= 17 && authorId.length <= 21 && authorId !== interaction.user.id) {
            return interaction.reply({ content: '❌ **هذا الإيمبد ليس لك! يرجى كتابة أمر `/ai` الخاص بك لاستخدامه.**', ephemeral: true });
        }

        // 1. SET NAME BUTTON
        if (interaction.isButton() && interaction.customId.startsWith('ai_set_name_')) {
            const uId = interaction.user.id;
            const modal = new ModalBuilder()
                .setCustomId(`ai_modal_name_${uId}`)
                .setTitle('تغيير اسم الذكاء الاصطناعي');

            const input = new TextInputBuilder()
                .setCustomId('ai_input_name')
                .setLabel('اسم البوت الجديد')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(32);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return await interaction.showModal(modal);
        }

        // 2. MODAL SUBMIT FOR NAME
        if (interaction.isModalSubmit() && interaction.customId.startsWith('ai_modal_name_')) {
            const newName = interaction.fields.getTextInputValue('ai_input_name');
            db[interaction.guildId].ai.name = newName;
            saveDB(db);

            // Update main embed
            const aiData = db[interaction.guildId].ai;
            const embed = EmbedBuilder.from(interaction.message.embeds[0]);
            embed.setDescription(
                `**اسم الذكاء الاصطناعي <:Ai:1521447887756722196> :** ${aiData.name}\n` +
                `-#  ~~                                                                                                                                                                  ~~\n` +
                `**صورة الذكاء الاصطناعي <:Photo:1516575747425439975> :** ${aiData.avatar === 'غير محدد' ? 'غير محدد' : `[انقر لعرض الصورة](${aiData.avatar})`}\n` +
                `-#  ~~                                                                                                                                                                  ~~\n` +
                `**حالة الذكاء الاصطناعي <:Status:1521447885412237364> :** ${aiData.status}\n` +
                `-#  ~~                                                                                                                                                                  ~~\n` +
                `**روم الكلام مع الـai <:Hastag:1516365641823551528> :** ${aiData.channelId ? `<#${aiData.channelId}>` : 'غير محدد'}\n` +
                `-#  ~~                                                                                                                                                                  ~~\n` +
                `**كاتاجوري المساعد 📁 :** ${aiData.categoryId ? `<#${aiData.categoryId}>` : 'غير محدد'}\n` +
                `-#  ~~                                                                                                                                                                  ~~\n` +
                `**نوع التدريب <:training:1521452247270293524> :** ${aiData.trainingType === 'auto' ? 'تدريب تلقائي (نفسه)' : (aiData.trainingType === 'manual' ? 'تدريب يدوي' : 'غير محدد')}`
            );

            await interaction.message.edit({ embeds: [embed] }).catch(() => {});
            return await interaction.reply({ content: '✅ **تم تعديل اسم المساعد الذكي بنجاح!**', ephemeral: true });
        }

        // 3. SET AVATAR BUTTON
        if (interaction.isButton() && interaction.customId.startsWith('ai_set_avatar_')) {
            const uId = interaction.user.id;
            activeStates.set(uId, {
                type: 'ai_upload_avatar',
                channelId: interaction.channelId,
                messageId: interaction.message.id,
                adminId: uId
            });
            return await interaction.reply({ content: '📷 **يرجى إرسال الصورة في هذا الروم كملف مرفق الآن لإعدادها كرمز للذكاء الاصطناعي.**', ephemeral: true });
        }

        // 4. SET STATUS BUTTON
        if (interaction.isButton() && interaction.customId.startsWith('ai_set_status_')) {
            const uId = interaction.user.id;
            const btnOn = new ButtonBuilder().setCustomId(`ai_status_on_${uId}`).setLabel('متصل').setEmoji('1521447885412237364').setStyle(ButtonStyle.Success);
            const btnOff = new ButtonBuilder().setCustomId(`ai_status_off_${uId}`).setLabel('غير متصل').setEmoji('1516534087161221233').setStyle(ButtonStyle.Danger);
            const row = new ActionRowBuilder().addComponents(btnOn, btnOff);

            return await interaction.reply({ content: '⚙️ **يرجى تحديد حالة الذكاء الاصطناعي المطلوبة:**', components: [row], ephemeral: true });
        }

        // 5. STATUS SELECTION CLICKS
        if (interaction.isButton() && (interaction.customId.startsWith('ai_status_on_') || interaction.customId.startsWith('ai_status_off_'))) {
            const isOn = interaction.customId.startsWith('ai_status_on_');
            db[interaction.guildId].ai.status = isOn ? 'متصل' : 'غير متصل';
            saveDB(db);

            // Edit main embed
            const aiData = db[interaction.guildId].ai;
            try {
                // Find main message
                const refMsg = interaction.message.reference?.messageId;
                const originalMsg = refMsg ? await interaction.channel.messages.fetch(refMsg).catch(() => null) : null;
                if (originalMsg) {
                    const embed = EmbedBuilder.from(originalMsg.embeds[0]);
                    embed.setDescription(
                        `**اسم الذكاء الاصطناعي <:Ai:1521447887756722196> :** ${aiData.name}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**صورة الذكاء الاصطناعي <:Photo:1516575747425439975> :** ${aiData.avatar === 'غير محدد' ? 'غير محدد' : `[انقر لعرض الصورة](${aiData.avatar})`}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**حالة الذكاء الاصطناعي <:Status:1521447885412237364> :** ${aiData.status}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**روم الكلام مع الـai <:Hastag:1516365641823551528> :** ${aiData.channelId ? `<#${aiData.channelId}>` : 'غير محدد'}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**كاتاجوري المساعد 📁 :** ${aiData.categoryId ? `<#${aiData.categoryId}>` : 'غير محدد'}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**نوع التدريب <:training:1521452247270293524> :** ${aiData.trainingType === 'auto' ? 'تدريب تلقائي (نفسه)' : (aiData.trainingType === 'manual' ? 'تدريب يدوي' : 'غير محدد')}`
                    );
                    await originalMsg.edit({ embeds: [embed] }).catch(() => {});
                }
            } catch (e) {}

            return await interaction.update({ content: `✅ **تم تعديل حالة الذكاء الاصطناعي إلى: ${aiData.status} ${isOn ? '🟢' : '🔴'}**`, components: [] });
        }

        // 6. SET CHANNEL BUTTON
        if (interaction.isButton() && interaction.customId.startsWith('ai_set_channel_')) {
            const uId = interaction.user.id;
            const aiData = db[interaction.guildId].ai;
            if (aiData.status !== 'متصل') {
                return await interaction.reply({ content: '⚠️ **يجب أن تكون حالة الذكاء الاصطناعي (متصل) لتتمكن من تحديد روم الكلام!**', ephemeral: true });
            }

            const select = new ChannelSelectMenuBuilder()
                .setCustomId(`ai_select_channel_${uId}`)
                .setPlaceholder('اختر روم الشات مع المساعد الذكي...')
                .addChannelTypes(ChannelType.GuildText);

            const row = new ActionRowBuilder().addComponents(select);
            return await interaction.reply({ content: '💬 **يرجى تحديد الروم المخصص للكلام مع المساعد الذكي:**', components: [row], ephemeral: true });
        }

        // 7. CHANNEL SELECTION SUBMIT
        if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('ai_select_channel_')) {
            const selectedId = interaction.values[0];
            db[interaction.guildId].ai.channelId = selectedId;
            saveDB(db);

            // Edit main embed
            const aiData = db[interaction.guildId].ai;
            try {
                const refMsg = interaction.message.reference?.messageId;
                const originalMsg = refMsg ? await interaction.channel.messages.fetch(refMsg).catch(() => null) : null;
                if (originalMsg) {
                    const embed = EmbedBuilder.from(originalMsg.embeds[0]);
                    embed.setDescription(
                        `**اسم الذكاء الاصطناعي <:Ai:1521447887756722196> :** ${aiData.name}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**صورة الذكاء الاصطناعي <:Photo:1516575747425439975> :** ${aiData.avatar === 'غير محدد' ? 'غير محدد' : `[انقر لعرض الصورة](${aiData.avatar})`}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**حالة الذكاء الاصطناعي <:Status:1521447885412237364> :** ${aiData.status}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**روم الكلام مع الـai <:Hastag:1516365641823551528> :** <#${selectedId}>\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**كاتاجوري المساعد 📁 :** ${aiData.categoryId ? `<#${aiData.categoryId}>` : 'غير محدد'}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**نوع التدريب <:training:1521452247270293524> :** ${aiData.trainingType === 'auto' ? 'تدريب تلقائي (نفسه)' : (aiData.trainingType === 'manual' ? 'تدريب يدوي' : 'غير محدد')}`
                    );
                    await originalMsg.edit({ embeds: [embed] }).catch(() => {});
                }
            } catch (e) {}

            return await interaction.update({ content: `✅ **تم تحديد روم الكلام مع الـai بنجاح: <#${selectedId}>**`, components: [] });
        }

        // 8. SET CATEGORY BUTTON
        if (interaction.isButton() && interaction.customId.startsWith('ai_set_category_')) {
            const uId = interaction.user.id;
            const select = new ChannelSelectMenuBuilder()
                .setCustomId(`ai_select_category_${uId}`)
                .setPlaceholder('اختر الكاتاجوري المخصص للمساعد الذكي...')
                .addChannelTypes(ChannelType.GuildCategory);

            const row = new ActionRowBuilder().addComponents(select);
            return await interaction.reply({ content: '📁 **يرجى تحديد الكاتاجوري المعتمد للمساعد الذكي (سيرد في جميع رومات هذا الكاتاجوري):**', components: [row], ephemeral: true });
        }

        // 9. CATEGORY SELECTION SUBMIT
        if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('ai_select_category_')) {
            const selectedId = interaction.values[0];
            db[interaction.guildId].ai.categoryId = selectedId;
            saveDB(db);

            // Edit main embed
            const aiData = db[interaction.guildId].ai;
            try {
                const refMsg = interaction.message.reference?.messageId;
                const originalMsg = refMsg ? await interaction.channel.messages.fetch(refMsg).catch(() => null) : null;
                if (originalMsg) {
                    const embed = EmbedBuilder.from(originalMsg.embeds[0]);
                    embed.setDescription(
                        `**اسم الذكاء الاصطناعي <:Ai:1521447887756722196> :** ${aiData.name}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**صورة الذكاء الاصطناعي <:Photo:1516575747425439975> :** ${aiData.avatar === 'غير محدد' ? 'غير محدد' : `[انقر لعرض الصورة](${aiData.avatar})`}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**حالة الذكاء الاصطناعي <:Status:1521447885412237364> :** ${aiData.status}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**روم الكلام مع الـai <:Hastag:1516365641823551528> :** ${aiData.channelId ? `<#${aiData.channelId}>` : 'غير محدد'}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**كاتاجوري المساعد 📁 :** <#${selectedId}>\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**نوع التدريب <:training:1521452247270293524> :** ${aiData.trainingType === 'auto' ? 'تدريب تلقائي (نفسه)' : (aiData.trainingType === 'manual' ? 'تدريب يدوي' : 'غير محدد')}`
                    );
                    await originalMsg.edit({ embeds: [embed] }).catch(() => {});
                }
            } catch (e) {}

            return await interaction.update({ content: `✅ **تم تحديد الكاتاجوري المخصص للمساعد الذكي بنجاح: <#${selectedId}>**`, components: [] });
        }

        // 10. TRAINING PROMPT BUTTON
        if (interaction.isButton() && interaction.customId.startsWith('ai_train_prompt_')) {
            const uId = interaction.user.id;
            const btnAuto = new ButtonBuilder().setCustomId(`ai_train_auto_${uId}`).setLabel('تدريب نفسه').setEmoji('1521452247270293524').setStyle(ButtonStyle.Success);
            const btnManual = new ButtonBuilder().setCustomId(`ai_train_manual_${uId}`).setLabel('أدربه بنفسي').setEmoji('1516365639760085033').setStyle(ButtonStyle.Primary);
            const row = new ActionRowBuilder().addComponents(btnAuto, btnManual);

            return await interaction.reply({
                content: '🧠 **هل تود أن يدرب الذكاء الاصطناعي نفسه تلقائياً ويبحث في رومات السيرفر والرتب، أم تريد تدريبه بنفسك يدوياً وإضافة القواعد؟**',
                components: [row],
                ephemeral: true
            });
        }

        // 11. AUTO TRAINING SUBMIT
        if (interaction.isButton() && interaction.customId.startsWith('ai_train_auto_')) {
            await interaction.deferUpdate();
            
            const autoData = await performAutoTraining(interaction.guild);
            db[interaction.guildId].ai.autoTrainedData = autoData;
            db[interaction.guildId].ai.trainingType = 'auto';
            saveDB(db);

            // Edit main embed
            const aiData = db[interaction.guildId].ai;
            try {
                // Find main message
                let refMsg = interaction.message.reference?.messageId;
                if (!refMsg) {
                    // Try to fetch original from channel
                    const msgs = await interaction.channel.messages.fetch({ limit: 10 });
                    const orig = msgs.find(m => m.embeds[0] && m.embeds[0].title === 'إعدادات الذكاء الاصطناعي');
                    refMsg = orig?.id;
                }
                const originalMsg = refMsg ? await interaction.channel.messages.fetch(refMsg).catch(() => null) : null;
                if (originalMsg) {
                    const embed = EmbedBuilder.from(originalMsg.embeds[0]);
                    embed.setDescription(
                        `**اسم الذكاء الاصطناعي <:Ai:1521447887756722196> :** ${aiData.name}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**صورة الذكاء الاصطناعي <:Photo:1516575747425439975> :** ${aiData.avatar === 'غير محدد' ? 'غير محدد' : `[انقر لعرض الصورة](${aiData.avatar})`}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**حالة الذكاء الاصطناعي <:Status:1521447885412237364> :** ${aiData.status}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**روم الكلام مع الـai <:Hastag:1516365641823551528> :** ${aiData.channelId ? `<#${aiData.channelId}>` : 'غير محدد'}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**كاتاجوري المساعد 📁 :** ${aiData.categoryId ? `<#${aiData.categoryId}>` : 'غير محدد'}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**نوع التدريب <:training:1521452247270293524> :** تدريب تلقائي (نفسه)`
                    );
                    await originalMsg.edit({ embeds: [embed] }).catch(() => {});
                }
            } catch (e) {}

            return await interaction.editReply({
                content: '✅ **تم تدريب الذكاء الاصطناعي تلقائياً بنجاح!**\nلقد قمت بتحليل رتب السيرفر، الصلاحيات، القنوات، وترتيبها وقراءة بعض الرسائل الأخيرة لتعلم طبيعة السيرفر.',
                components: []
            });
        }

        // 12. MANUAL TRAINING SUBMIT
        if (interaction.isButton() && interaction.customId.startsWith('ai_train_manual_')) {
            db[interaction.guildId].ai.trainingType = 'manual';
            saveDB(db);

            // Edit main embed
            const aiData = db[interaction.guildId].ai;
            try {
                let refMsg = interaction.message.reference?.messageId;
                if (!refMsg) {
                    const msgs = await interaction.channel.messages.fetch({ limit: 10 });
                    const orig = msgs.find(m => m.embeds[0] && m.embeds[0].title === 'إعدادات الذكاء الاصطناعي');
                    refMsg = orig?.id;
                }
                const originalMsg = refMsg ? await interaction.channel.messages.fetch(refMsg).catch(() => null) : null;
                if (originalMsg) {
                    const embed = EmbedBuilder.from(originalMsg.embeds[0]);
                    embed.setDescription(
                        `**اسم الذكاء الاصطناعي <:Ai:1521447887756722196> :** ${aiData.name}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**صورة الذكاء الاصطناعي <:Photo:1516575747425439975> :** ${aiData.avatar === 'غير محدد' ? 'غير محدد' : `[انقر لعرض الصورة](${aiData.avatar})`}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**حالة الذكاء الاصطناعي <:Status:1521447885412237364> :** ${aiData.status}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**روم الكلام مع الـai <:Hastag:1516365641823551528> :** ${aiData.channelId ? `<#${aiData.channelId}>` : 'غير محدد'}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**كاتاجوري المساعد 📁 :** ${aiData.categoryId ? `<#${aiData.categoryId}>` : 'غير محدد'}\n` +
                        `-#  ~~                                                                                                                                                                  ~~\n` +
                        `**نوع التدريب <:training:1521452247270293524> :** تدريب يدوي`
                    );
                    await originalMsg.edit({ embeds: [embed] }).catch(() => {});
                }
            } catch (e) {}

            return await interaction.update({
                content: '👋 **مرحباً! كيف تريد تدريبي؟**\n\nأنا جاهز لتعلم مختلف المهام والردود مثل:\n' +
                         '• **الرد على الكلمات والأسئلة الشائعة** (مثال: وين روم الشراء؟)\n' +
                         '• **إعطاء وإزالة الرتب للأعضاء** تلقائياً (مثال: اعطِ @أحمد رتبة مميز)\n' +
                         '• **إخفاء أو إظهار الرومات** (مثال: اخفي الروم)\n' +
                         '• **إنشاء وحذف الرومات والرتب والتحكم بصلاحياتها**\n' +
                         '• **التحكم ومنع البوت عن قول أي شيء آخر إلا ما تحدده له**\n\n' +
                         '**فقط اكتب لي تعليماتك وقواعدك في روم المساعد وسأتعلمها وأحفظها فوراً!** 🧠✨',
                components: []
            });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'azkar_click') {
            const random = shortDhikrs[Math.floor(Math.random() * shortDhikrs.length)];
            return interaction.reply({ content: `✨ **الذكر المختار لك:**\n> *${random}*`, ephemeral: true });
        }
        if (interaction.customId === 'azkar_mosque') {
            return interaction.reply({ content: '🕋 **يرجى تحديد الدولة لعرض مواقيت الصلاة من القائمة أدناه:**', components: [getPrayerCountryMenu()], ephemeral: true });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_prayer_country') {
        await interaction.deferReply({ ephemeral: true });
        const val = interaction.values[0], country = arabCountries.find(c => c.value === val);
        if (!country) return interaction.editReply({ content: '❌ تعذر العثور على الدولة.' });
        try {
            const data = await fetchPrayerTimings(country.city, country.country, country.method);
            const buf = await generatePrayerCard(data, country.label);
            await interaction.editReply({ content: '', files: [new AttachmentBuilder(buf, { name: 'prayer_timings.png' })] });
        } catch (e) { console.error(e); await interaction.editReply({ content: '❌ حدث خطأ أثناء جلب مواقيت الصلاة.' }); }
    }

    if (interaction.isButton() && interaction.customId.startsWith('edit_panel_display_')) {
        const pid = interaction.customId.substring('edit_panel_display_'.length);
        const r = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`set_display_buttons_${pid}`).setLabel('أزرار عادية').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`set_display_select_${pid}`).setLabel('قائمة منسدلة').setStyle(ButtonStyle.Primary)
        );
        await interaction.reply({ content: '🎛️ **اختر طريقة عرض فتح التذاكر بالبانل:**', components: [r], ephemeral: true });
    }

    if (interaction.isButton() && (interaction.customId.startsWith('set_display_buttons_') || interaction.customId.startsWith('set_display_select_'))) {
        const isBtns = interaction.customId.startsWith('set_display_buttons_');
        const pid = isBtns ? interaction.customId.substring('set_display_buttons_'.length) : interaction.customId.substring('set_display_select_'.length);
        db[interaction.guildId].panels[pid].displayType = isBtns ? 'buttons' : 'select';
        saveDB(db);
        await interaction.update({ content: `✅ تم ضبط أسلوب العرض إلى: **${isBtns ? 'أزرار عادية' : 'قائمة منسدلة'}**`, components: [] });
        await updatePanelEmbed({ guildId: interaction.guildId, editReply: async d => { if (interaction.replied || interaction.deferred) return interaction.editReply(d).catch(()=>{}); else return interaction.reply({...d, fetchReply:true}).catch(()=>{}); }, replied: true }, pid);
    }

    if (interaction.isButton() && interaction.customId === 'publish_suggestion_prompt_btn') {
        const modal = new ModalBuilder().setCustomId('submit_suggestion_modal').setTitle('اقتراح جديد');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('suggestion_text_input').setLabel('اكتب اقتراحك هنا...').setStyle(TextInputStyle.Paragraph).setRequired(true)));
        await interaction.showModal(modal);
    }

    if (interaction.isButton() && interaction.customId.startsWith('send_panel_')) {
        const pid = interaction.customId.split('_')[2];
        const panel = db[interaction.guildId].panels[pid];
        if (!panel) return interaction.reply({ content: '❌ تعذر العثور على البانل.', ephemeral: true });

        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle(panel.title)
            .setDescription(panel.desc);
        if (panel.img && panel.img !== 'لايوجد') embed.setImage(panel.img);

        const components = [];
        if (panel.displayType === 'select') {
            const menu = new StringSelectMenuBuilder()
                .setCustomId(`ticket_panel_select_${pid}`)
                .setPlaceholder('اختر نوع التذكرة لفتحها...');
            if (panel.buttons && panel.buttons.length > 0) {
                panel.buttons.forEach((b, idx) => {
                    const opt = { label: b.name, value: `btn_${idx}` };
                    if (b.emoji) opt.emoji = b.emoji;
                    menu.addOptions(opt);
                });
            } else {
                menu.addOptions({ label: 'فتح تذكرة عامة', value: 'btn_default' });
            }
            components.push(new ActionRowBuilder().addComponents(menu));
        } else {
            const row = new ActionRowBuilder();
            if (panel.buttons && panel.buttons.length > 0) {
                panel.buttons.slice(0, 5).forEach((b, idx) => {
                    const btn = new ButtonBuilder()
                        .setCustomId(`ticket_panel_btn_${pid}_${idx}`)
                        .setLabel(b.name)
                        .setStyle(ButtonStyle.Primary);
                    if (b.emoji) btn.setEmoji(b.emoji);
                    row.addComponents(btn);
                });
            } else {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ticket_panel_btn_${pid}_default`)
                        .setLabel('فتح تذكرة')
                        .setEmoji('1516365643379773490')
                        .setStyle(ButtonStyle.Primary)
                );
            }
            components.push(row);
        }

        await interaction.channel.send({ embeds: [embed], components });
        await interaction.reply({ content: '✅ تم إرسال البانل إلى هذه القناة بنجاح!', ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket_panel_btn_')) {
        await interaction.deferReply({ ephemeral: true });
        const withoutPrefix = interaction.customId.substring('ticket_panel_btn_'.length);
        const lastUnderscore = withoutPrefix.lastIndexOf('_');
        const pid = lastUnderscore !== -1 ? withoutPrefix.substring(0, lastUnderscore) : withoutPrefix;
        const btnIdx = lastUnderscore !== -1 ? withoutPrefix.substring(lastUnderscore + 1) : 'default';
        
        const panel = db[interaction.guildId].panels[pid];
        if (!panel) return interaction.editReply({ content: '❌ تعذر العثور على إعدادات هذا البانل.' });

        db[interaction.guildId].counter = (db[interaction.guildId].counter || 0) + 1;
        const count = db[interaction.guildId].counter;
        const formattedCount = String(count).padStart(4, '0');
        const chName = `ticket-${formattedCount}`;

        let catId = panel.category || null;
        if (btnIdx !== 'default' && panel.buttons?.[btnIdx]?.category) {
            catId = panel.buttons[btnIdx].category;
        }

        const permissionOverwrites = [
            {
                id: interaction.guild.roles.everyone.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: interaction.user.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks]
            },
            {
                id: client.user.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageChannels]
            }
        ];

        if (panel.roles && panel.roles.length > 0) {
            panel.roles.forEach(roleId => {
                permissionOverwrites.push({
                    id: roleId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks]
                });
            });
        }

        const createOptions = {
            name: chName,
            type: ChannelType.GuildText,
            permissionOverwrites
        };
        if (catId) {
            createOptions.parent = catId;
        }

        const ch = await interaction.guild.channels.create(createOptions).catch(err => {
            console.error('Failed to create ticket channel:', err);
            return null;
        });

        if (!ch) return interaction.editReply({ content: '❌ فشل إنشاء قناة التذكرة، يرجى التأكد من صلاحيات البوت.' });

        const ticketId = ch.id;
        if (!db[interaction.guildId].tickets) db[interaction.guildId].tickets = {};
        db[interaction.guildId].tickets[ticketId] = {
            id: ticketId,
            creatorId: interaction.user.id,
            panelId: pid,
            claimerId: null,
            createdAt: Date.now()
        };
        saveDB(db);

        const welcomeEmbed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle(`تذكرة جديدة | ${chName}`)
            .setDescription(panel.welcome)
            .setFooter({ text: 'لإغلاق التذكرة، استخدم القائمة المنسدلة لإدارة التذكرة.' });
        if (panel.welcome_img && panel.welcome_img !== 'لايوجد') welcomeEmbed.setImage(panel.welcome_img);

        const row = getTicketComponents({ id: ticketId, claimerId: null });

        await ch.send({ content: `مرحباً بك <@${interaction.user.id}> | طاقم الدعم <@&${panel.roles?.[0] || ''}>`, embeds: [welcomeEmbed], components: row });
        await interaction.editReply({ content: `<:Hastag:1516365641823551528> | تم إنشاء تذكرتك بنجاح: ${ch}` });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_panel_select_')) {
        await interaction.deferReply({ ephemeral: true });
        const pid = interaction.customId.substring('ticket_panel_select_'.length);
        const val = interaction.values[0];
        const btnIdx = val.startsWith('btn_') ? val.split('_')[1] : 'default';

        const panel = db[interaction.guildId].panels[pid];
        if (!panel) return interaction.editReply({ content: '❌ تعذر العثور على إعدادات هذا البانل.' });

        db[interaction.guildId].counter = (db[interaction.guildId].counter || 0) + 1;
        const count = db[interaction.guildId].counter;
        const formattedCount = String(count).padStart(4, '0');
        const chName = `ticket-${formattedCount}`;

        let catId = panel.category || null;
        if (btnIdx !== 'default' && panel.buttons?.[btnIdx]?.category) {
            catId = panel.buttons[btnIdx].category;
        }

        const permissionOverwrites = [
            {
                id: interaction.guild.roles.everyone.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: interaction.user.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks]
            },
            {
                id: client.user.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageChannels]
            }
        ];

        if (panel.roles && panel.roles.length > 0) {
            panel.roles.forEach(roleId => {
                permissionOverwrites.push({
                    id: roleId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks]
                });
            });
        }

        const createOptions = {
            name: chName,
            type: ChannelType.GuildText,
            permissionOverwrites
        };
        if (catId) {
            createOptions.parent = catId;
        }

        const ch = await interaction.guild.channels.create(createOptions).catch(err => {
            console.error('Failed to create ticket channel:', err);
            return null;
        });

        if (!ch) return interaction.editReply({ content: '❌ فشل إنشاء قناة التذكرة، يرجى التأكد من صلاحيات البوت.' });

        const ticketId = ch.id;
        if (!db[interaction.guildId].tickets) db[interaction.guildId].tickets = {};
        db[interaction.guildId].tickets[ticketId] = {
            id: ticketId,
            creatorId: interaction.user.id,
            panelId: pid,
            claimerId: null,
            createdAt: Date.now()
        };
        saveDB(db);

        const welcomeEmbed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle(`تذكرة جديدة | ${chName}`)
            .setDescription(panel.welcome)
            .setFooter({ text: 'لإغلاق التذكرة، استخدم القائمة المنسدلة لإدارة التذكرة.' });
        if (panel.welcome_img && panel.welcome_img !== 'لايوجد') welcomeEmbed.setImage(panel.welcome_img);

        const row = getTicketComponents({ id: ticketId, claimerId: null });

        await ch.send({ content: `مرحباً بك <@${interaction.user.id}> | طاقم الدعم <@&${panel.roles?.[0] || ''}>`, embeds: [welcomeEmbed], components: row });
        await interaction.editReply({ content: `<:Hastag:1516365641823551528> | تم إنشاء تذكرتك بنجاح: ${ch}` });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'submit_suggestion_modal') {
        await interaction.deferReply({ ephemeral: true });
        const text = interaction.fields.getTextInputValue('suggestion_text_input');
        try {
            const config = db[interaction.guildId]?.suggestions;
            if (!config || !config.channelId) return interaction.editReply({ content: '❌ نظام الاقتراحات غير مهيأ بالكامل.' });
            const ch = await interaction.guild.channels.fetch(config.channelId).catch(() => null);
            if (!ch) return interaction.editReply({ content: '❌ لم يتم العثور على روم الاقتراحات.' });
            let webhooks = await ch.fetchWebhooks();
            let wh = webhooks.find(w => w.owner.id === client.user.id);
            if (!wh) wh = await ch.createWebhook({ name: 'NTL Suggestions', avatar: client.user.displayAvatarURL() });
            const em = new EmbedBuilder().setColor('#2b2d31').setDescription(`**إقتراح <:PErson:1516382944510607511>: <@${interaction.user.id}>**\n-#  ~~                                                                                                                                                                   ~~\n\n${text}`);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('publish_suggestion_prompt_btn').setLabel('نشر إقتراح').setEmoji('1517591602049056829').setStyle(ButtonStyle.Success), new ButtonBuilder().setEmoji('1517590248501022791').setURL('https://discord.gg/qZtbA27mH2').setStyle(ButtonStyle.Link));
            const msg = await wh.send({ username: interaction.user.username, avatarURL: interaction.user.displayAvatarURL({ dynamic: true }), embeds: [em], components: [row], wait: true });
            await msg.startThread({ name: `نقاش - اقتراح ${interaction.user.username}`, autoArchiveDuration: 1440 }).catch(()=>{});
            await interaction.editReply({ content: '✅ تم إرسال اقتراحك ونشره بنجاح!' });
        } catch(e) { console.error(e); await interaction.editReply({ content: '❌ حدث خطأ أثناء إرسال الاقتراح.' }); }
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('edit_texts_')) {
        const pid = interaction.customId.split('_')[2], p = db[interaction.guildId].panels[pid];
        const m = new ModalBuilder().setCustomId(`modal_edit_texts_${pid}`).setTitle('تعديل نصوص البانل');
        m.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_title').setLabel('العنوان الجديد').setStyle(TextInputStyle.Short).setValue(p.title).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_desc').setLabel('الوصف الجديد').setStyle(TextInputStyle.Paragraph).setValue(p.desc).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_welcome').setLabel('رسالة الترحيب الجديدة').setStyle(TextInputStyle.Paragraph).setValue(p.welcome).setRequired(true))
        );
        await interaction.showModal(m);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_edit_texts_')) {
        const pid = interaction.customId.split('_')[3];
        db[interaction.guildId].panels[pid].title = interaction.fields.getTextInputValue('p_title');
        db[interaction.guildId].panels[pid].desc = interaction.fields.getTextInputValue('p_desc');
        db[interaction.guildId].panels[pid].welcome = interaction.fields.getTextInputValue('p_welcome');
        saveDB(db);
        await interaction.deferUpdate();
        await updatePanelEmbed(interaction, pid);
    }

    if (interaction.isButton() && interaction.customId.startsWith('edit_roles_')) {
        const pid = interaction.customId.split('_')[2];
        const rMenu = new RoleSelectMenuBuilder().setCustomId(`save_roles_${pid}`).setPlaceholder('اختر رتب الدعم الفني للبوت...').setMinValues(1).setMaxValues(10);
        await interaction.reply({ content: '👤 **يرجى تحديد الرتب التي ينبغي أن تستلم التذاكر:**', components: [new ActionRowBuilder().addComponents(rMenu)], ephemeral: true });
    }

    if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('save_roles_')) {
        const pid = interaction.customId.split('_')[2];
        db[interaction.guildId].panels[pid].roles = interaction.values;
        saveDB(db);
        await interaction.deferUpdate();
        await updatePanelEmbed(interaction, pid);
    }

    if (interaction.isButton() && interaction.customId.startsWith('edit_images_')) {
        const pid = interaction.customId.split('_')[2];
        const r = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`set_img_type_welcome_${pid}`).setLabel('للترحيب').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`set_img_type_panel_${pid}`).setLabel('لالبانل').setStyle(ButtonStyle.Primary)
        );
        await interaction.update({ content: '📸 **تعديل الصورة لأي إيمبد؟**', embeds: [], components: [r] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('set_img_type_')) {
        const parts = interaction.customId.split('_'), type = parts[3], pid = parts[4];
        const r = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`save_img_src_guild_${pid}_${type}`).setLabel('صورة السيرفر').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`save_img_src_upload_${pid}_${type}`).setLabel('صورة من الاستوديو').setStyle(ButtonStyle.Secondary)
        );
        await interaction.update({ content: '📥 **تريد استخدام صورة السيرفر أم صورة مخصصة؟**', components: [r] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('save_img_src_')) {
        const parts = interaction.customId.split('_'), src = parts[3], pid = parts[4], type = parts[5];
        if (src === 'guild') {
            const icon = interaction.guild.iconURL({ size: 1024 });
            if (!icon) return interaction.reply({ content: '❌ لا توجد صورة رمزية للسيرفر.', ephemeral: true });
            if (type === 'welcome') db[interaction.guildId].panels[pid].welcome_img = icon;
            else db[interaction.guildId].panels[pid].img = icon;
            saveDB(db);
            await interaction.deferUpdate();
            await updatePanelEmbed({ guildId: interaction.guildId, editReply: async d => { if (interaction.replied || interaction.deferred) return interaction.editReply(d).catch(()=>{}); else return interaction.reply({...d, fetchReply:true}).catch(()=>{}); }, replied: true }, pid);
        } else {
            activeStates.set(interaction.user.id, { type: 'upload_image', panelId: pid, imgType: type });
            await interaction.update({ content: '💬 **يرجى إرسال الصورة في هذا الشات ليقوم الكاميرا بمعاينتها وحفظها.**', components: [] });
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('edit_buttons_')) {
        const pid = interaction.customId.split('_')[2];
        const r = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`btn_opt_add_${pid}`).setLabel('إضافة زر').setEmoji('1516365643379773490').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`btn_opt_remove_${pid}`).setLabel('إزالة زر').setEmoji('1516426882944467144').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`edit_panel_display_${pid}`).setLabel('تحديد العرض للزر').setEmoji('1517268988873277571').setStyle(ButtonStyle.Secondary)
        );
        await interaction.update({ content: '🎛 *اختر تعديل أزرار الدعم بالتذاكر:*', embeds: [], components: [r] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('btn_opt_add_')) {
        const pid = interaction.customId.split('_')[3];
        const m = new ModalBuilder().setCustomId(`modal_add_btn_name_${pid}`).setTitle('إضافة زر جديد');
        m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('btn_name').setLabel('اسم الزر الجديد').setStyle(TextInputStyle.Short).setRequired(true)));
        await interaction.showModal(m);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_add_btn_name_')) {
        const pid = interaction.customId.split('_')[4], name = interaction.fields.getTextInputValue('btn_name');
        activeStates.set(interaction.user.id, { type: 'pending_button', panelId: pid, btnName: name });
        const r = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`btn_emoji_choice_yes_${pid}`).setLabel('نعم').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`btn_emoji_choice_no_${pid}`).setLabel('لا').setStyle(ButtonStyle.Danger)
        );
        await interaction.reply({ content: `❓ هل تريد إرفاق إيموجي مخصص مضاف مع الزر **"${name}"**؟`, components: [r], ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId.startsWith('btn_emoji_choice_no_')) {
        const pid = interaction.customId.split('_')[4], st = activeStates.get(interaction.user.id);
        if (!st) return interaction.reply({ content: '❌ حدث خطأ، يرجى إعادة المحاولة.', ephemeral: true });
        const p = db[interaction.guildId].panels[pid];
        if (!p.buttons) p.buttons = [];
        p.buttons.push({ name: st.btnName, category: null, emoji: null });
        saveDB(db);
        activeStates.delete(interaction.user.id);
        await interaction.update({ content: `✅ تم إضافة الزر **"${st.btnName}"** بدون إيموجي بنجاح!`, components: [] });
        await updatePanelEmbed({ guildId: interaction.guildId, editReply: async d => { if (interaction.replied || interaction.deferred) return interaction.editReply(d).catch(()=>{}); else return interaction.reply({...d, fetchReply:true}).catch(()=>{}); }, replied: true }, pid);
    }

    if (interaction.isButton() && interaction.customId.startsWith('btn_emoji_choice_yes_')) {
        const pid = interaction.customId.split('_')[4], st = activeStates.get(interaction.user.id);
        if (!st) return interaction.reply({ content: '❌ حدث خطأ في معالجة الطلب.', ephemeral: true });
        st.type = 'upload_emoji'; activeStates.set(interaction.user.id, st);
        await interaction.update({ content: '💬 **يرجى إرسال الإيموجي المطلوب في الشات (إيموجي عادي أو مخصص من ديسكورد).**', components: [] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('select_btn_cat_')) {
        const pid = interaction.customId.split('_')[3];
        const select = new ChannelSelectMenuBuilder()
            .setCustomId(`save_btn_cat_${pid}`)
            .setPlaceholder('اختر الكاتاجوري المخصص للتذاكر...')
            .addChannelTypes(ChannelType.GuildCategory);
        const row = new ActionRowBuilder().addComponents(select);
        return await interaction.reply({ content: '📁 **يرجى تحديد الكاتاجوري الذي سيتم إنشاء تذاكر هذا البانل فيه:**', components: [row], ephemeral: true });
    }

    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('save_btn_cat_')) {
        const pid = interaction.customId.split('_')[3];
        const selectedId = interaction.values[0];
        db[interaction.guildId].panels[pid].category = selectedId;
        saveDB(db);
        await interaction.update({ content: '✅ تم ضبط كاتاجوري التذاكر بنجاح!', components: [] });
        await updatePanelEmbed({ guildId: interaction.guildId, editReply: async d => { if (interaction.replied || interaction.deferred) return interaction.editReply(d).catch(()=>{}); else return interaction.reply({...d, fetchReply:true}).catch(()=>{}); }, replied: true }, pid);
    }

    // 1. Claim Button Handler
    if (interaction.isButton() && interaction.customId.startsWith('claim_')) {
        const tid = interaction.customId.split('_')[1];
        const tickets = db[interaction.guildId]?.tickets || {};
        const ticketInfo = tickets[tid];
        if (!ticketInfo) return interaction.reply({ content: '❌ تعذر العثور على معلومات هذه التذكرة.', ephemeral: true });

        const panel = db[interaction.guildId].panels[ticketInfo.panelId];
        if (!panel) return interaction.reply({ content: '❌ تعذر العثور على بانل هذه التذكرة.', ephemeral: true });

        const isSupport = panel.roles?.some(rId => interaction.member.roles.cache.has(rId)) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!isSupport) {
            return interaction.reply({ content: '❌ ليس لديك صلاحية استلام هذه التذكرة.', ephemeral: true });
        }

        const currentClaimer = ticketInfo.claimerId;
        if (currentClaimer === null) {
            ticketInfo.claimerId = interaction.user.id;
            saveDB(db);
            const comps = getTicketComponents(ticketInfo);
            await interaction.update({ components: comps });
            await interaction.channel.send({ content: `<:claim:1516357850207879209> | تم استلام التذكرة بنجاح بواسطة <@${interaction.user.id}>` });
        } else {
            if (currentClaimer !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ لا يمكنك إلغاء استلام تذكرة مستلمة بواسطة عضو آخر.', ephemeral: true });
            }
            ticketInfo.claimerId = null;
            saveDB(db);
            const comps = getTicketComponents(ticketInfo);
            await interaction.update({ components: comps });
            await interaction.channel.send({ content: `🔓 | تم إلغاء استلام التذكرة بواسطة <@${interaction.user.id}>` });
        }
    }

    // 2. Ticket Management Dropdown Handler
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_mgmt_')) {
        const tid = interaction.customId.split('_')[2];
        const tickets = db[interaction.guildId]?.tickets || {};
        const ticketInfo = tickets[tid];
        if (!ticketInfo) return interaction.reply({ content: '❌ تعذر العثور على معلومات هذه التذكرة.', ephemeral: true });

        const val = interaction.values[0];

        if (val === 'info') {
            if (ticketInfo.claimerId) {
                return interaction.reply({ content: `ℹ️ **التذكرة مستلمة بواسطة:** <@${ticketInfo.claimerId}>`, ephemeral: true });
            } else {
                return interaction.reply({ content: 'ℹ️ **هذه التذكرة غير مستلمة حتى الآن.**', ephemeral: true });
            }
        }

        if (val === 'add') {
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId(`add_member_to_${tid}`)
                .setPlaceholder('اختر العضو المراد إضافته للتذكرة...');
            return interaction.reply({ content: '👤 **اختر العضو لإضافته إلى التذكرة:**', components: [new ActionRowBuilder().addComponents(userSelect)], ephemeral: true });
        }

        if (val === 'remove') {
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId(`remove_member_from_${tid}`)
                .setPlaceholder('اختر العضو المراد إزالته من التذكرة...');
            return interaction.reply({ content: '👤 **اختر العضو لإزالته من التذكرة:**', components: [new ActionRowBuilder().addComponents(userSelect)], ephemeral: true });
        }

        if (val === 'summon') {
            await interaction.reply({ content: `🔔 تم إرسال استدعاء لصاحب التذكرة.`, ephemeral: true });
            return interaction.channel.send({ content: `🔔 <@${ticketInfo.creatorId}>، لقد تم استدعاؤك إلى التذكرة بواسطة <@${interaction.user.id}>` });
        }

        if (val === 'rename') {
            const modal = new ModalBuilder().setCustomId(`rename_modal_${tid}`).setTitle('تعديل اسم التذكرة');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('new_name')
                    .setLabel('اسم التذكرة الجديد')
                    .setValue(interaction.channel.name)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ));
            return interaction.showModal(modal);
        }

        if (val === 'reset') {
            const panel = db[interaction.guildId].panels[ticketInfo.panelId];
            const overwrites = [
                {
                    id: interaction.guild.roles.everyone.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: ticketInfo.creatorId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks]
                },
                {
                    id: client.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageChannels]
                }
            ];
            if (panel?.roles) {
                panel.roles.forEach(rId => {
                    overwrites.push({
                        id: rId,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks]
                    });
                });
            }
            await interaction.channel.permissionOverwrites.set(overwrites);
            return interaction.reply({ content: '✅ تم إعادة ضبط صلاحيات ورخص التذكرة إلى الوضع الافتراضي بنجاح!', ephemeral: true });
        }
    }

    // 3. User Select Menu - Add Member
    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('add_member_to_')) {
        const tid = interaction.customId.split('_')[3];
        const targetUserId = interaction.values[0];
        await interaction.channel.permissionOverwrites.edit(targetUserId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true
        });
        await interaction.reply({ content: `✅ تم إضافة العضو <@${targetUserId}> إلى التذكرة بنجاح!`, ephemeral: true });
        await interaction.channel.send({ content: `🔔 | تم إضافة العضو <@${targetUserId}> إلى التذكرة بواسطة <@${interaction.user.id}>` });
    }

    // 4. User Select Menu - Remove Member
    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('remove_member_from_')) {
        const tid = interaction.customId.split('_')[3];
        const targetUserId = interaction.values[0];
        await interaction.channel.permissionOverwrites.delete(targetUserId).catch(() => {
            return interaction.channel.permissionOverwrites.edit(targetUserId, { ViewChannel: false });
        });
        await interaction.reply({ content: `✅ تم إزالة العضو <@${targetUserId}> من التذكرة بنجاح!`, ephemeral: true });
        await interaction.channel.send({ content: `🔔 | تم إزالة العضو <@${targetUserId}> من التذكرة بواسطة <@${interaction.user.id}>` });
    }

    // 5. View Transcript Button Handler (Works in DM or Guild)
    if (interaction.isButton() && interaction.customId.startsWith('view_transcript_')) {
        const parts = interaction.customId.split('_');
        const gid = parts[2];
        const tid = parts[3];
        
        const localDb = getDB();
        const ticketInfo = localDb[gid]?.tickets?.[tid];
        if (!ticketInfo) {
            return interaction.reply({ content: '❌ تعذر العثور على سجل هذه التذكرة أو أنه قد تم حذفه.', ephemeral: true });
        }
        
        const channelName = ticketInfo.id ? `ticket-${tid}` : 'ticket';
        const htmlContent = generateTranscriptHTML(ticketInfo, channelName);
        
        await interaction.reply({
            files: [new AttachmentBuilder(Buffer.from(htmlContent), { name: 'index.html' })],
            ephemeral: true
        });
    }

    if (interaction.isButton() && interaction.customId.startsWith('delete_req_')) {
        const tid = interaction.customId.split('_')[2];
        const r = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`del_confirm_${tid}`).setEmoji('1516534090751279257').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('del_cancel').setEmoji('1516534087161221233').setStyle(ButtonStyle.Danger));
        await interaction.reply({ content: `<@${interaction.user.id}>`, embeds: [new EmbedBuilder().setColor('#ff0000').setDescription(`<:dLete:1516357693328330782> | هل أنت متأكد من حذف هذه التذكرة؟`)], components: [r] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('del_confirm_')) {
        const tid = interaction.customId.split('_')[2];
        const tickets = db[interaction.guildId]?.tickets || {};
        const ticketInfo = tickets[tid];
        
        if (ticketInfo) {
            const creatorId = ticketInfo.creatorId;
            const claimerId = ticketInfo.claimerId;
            const createdAt = ticketInfo.createdAt;
            const closedAt = Date.now();
            const closerId = interaction.user.id;
            
            const embedDesc = `تم فتح التذكرة بواسطة <:PErson:1516382944510607511> :\n<@${creatorId}>\n-# ~~ ~~\nمستلم التذكرة <:claim:1516357850207879209> :\n${claimerId ? `<@${claimerId}>` : 'لا أحد'}\n-# ~~ ~~\nتم إغلاق التذكرة بواسطة <:dLete:1516357693328330782> :\n<@${closerId}>\n-# ~~ ~~\nوقت إنشاء التذكرة <:time:1525620369879339168> :\n<t:${Math.floor(createdAt / 1000)}:F>\n-# ~~ ~~\nوقت إغلاق التذكرة <:time:1525620369879339168> :\n<t:${Math.floor(closedAt / 1000)}:F>`;
            
            let files = [];
            const fs = require('fs');
            const scrollImagePath = path.join(process.cwd(), 'src/assets/images/ticket_scroll_1783845727490.jpg');
            if (fs.existsSync(scrollImagePath)) {
                files.push(new AttachmentBuilder(scrollImagePath, { name: 'ticket_scroll.jpg' }));
            }
            
            const dmEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('تفاصيل غلق التذكرة')
                .setDescription(embedDesc);
                
            if (files.length > 0) {
                dmEmbed.setImage('attachment://ticket_scroll.jpg');
            }
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`view_transcript_${interaction.guildId}_${tid}`)
                    .setLabel('عرض سجل التذكرة')
                    .setStyle(ButtonStyle.Primary)
            );
            
            const creator = await interaction.guild.members.fetch(creatorId).catch(() => null);
            if (creator) {
                await creator.send({ embeds: [dmEmbed], components: [row], files }).catch(err => {
                    console.error('Failed to send DM to ticket creator:', err);
                });
            }
        }

        await interaction.update({ content: 'سيتم حذف التذكرة خلال عشر ثواني...', embeds: [], components: [] });
        setTimeout(() => interaction.channel.delete().catch(()=>{}), 10000);
    }

    if (interaction.isButton() && interaction.customId === 'del_cancel') await interaction.message.delete().catch(()=>{});

    // معالجات تفاعل الأغاني
    if (interaction.isButton() && interaction.customId.startsWith('music_pause_')) {
        const guildId = interaction.customId.split('_')[2];
        const kazagumo = getKazagumo();
        const player = kazagumo.players.get(guildId);
        if (!player) return interaction.reply({ content: '❌ لا توجد أغنية تعمل حالياً!', ephemeral: true });

        if (interaction.member?.voice?.channelId !== player.voiceId) {
            return interaction.reply({ content: '❌ يجب أن تكون في نفس الروم الصوتي للتحكم بالبوت!', ephemeral: true });
        }

        const currentTrack = player.queue.current;
        if (currentTrack && currentTrack.requester && currentTrack.requester.id && currentTrack.requester.id !== interaction.user.id) {
            return interaction.reply({ content: `❌ لا يمكنك استخدام زر الإيقاف المؤقت! فقط العضو الذي طلب الأغنية (<@${currentTrack.requester.id}>) يمكنه إيقافها/تشغيلها مؤقتاً.`, ephemeral: true });
        }

        player.pause(!player.paused);
        await interaction.deferUpdate();

        const gp = guildPlayers.get(guildId);
        if (gp && gp.activeMessage) {
            const payload = makePlayerEmbedAndButtons(guildId, player);
            if (payload) {
                await gp.activeMessage.edit(payload).catch(() => {});
            }
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('music_next_')) {
        const guildId = interaction.customId.split('_')[2];
        const kazagumo = getKazagumo();
        const player = kazagumo.players.get(guildId);
        if (!player) return interaction.reply({ content: '❌ لا توجد أغنية تعمل حالياً!', ephemeral: true });

        if (interaction.member?.voice?.channelId !== player.voiceId) {
            return interaction.reply({ content: '❌ يجب أن تكون في نفس الروم الصوتي للتحكم بالبوت!', ephemeral: true });
        }

        const currentTrack = player.queue.current;
        if (currentTrack) {
            const gp = guildPlayers.get(guildId) || { history: [], activeMessage: null };
            gp.history.push(currentTrack);
            guildPlayers.set(guildId, gp);
        }

        await player.skip();
        await interaction.deferUpdate();
    }

    if (interaction.isButton() && interaction.customId.startsWith('music_prev_')) {
        const guildId = interaction.customId.split('_')[2];
        const kazagumo = getKazagumo();
        const player = kazagumo.players.get(guildId);
        if (!player) return interaction.reply({ content: '❌ لا توجد أغنية تعمل حالياً!', ephemeral: true });

        if (interaction.member?.voice?.channelId !== player.voiceId) {
            return interaction.reply({ content: '❌ يجب أن تكون في نفس الروم الصوتي للتحكم بالبوت!', ephemeral: true });
        }

        const gp = guildPlayers.get(guildId);
        if (!gp || !gp.history || gp.history.length === 0) {
            return interaction.reply({ content: '❌ لا توجد أغاني سابقة في الذاكرة لتشغيلها!', ephemeral: true });
        }

        const prevTrack = gp.history.pop();
        const currentTrack = player.queue.current;

        if (currentTrack) {
            player.queue.unshift(currentTrack);
        }

        player.queue.unshift(prevTrack);
        await player.skip();
        await interaction.deferUpdate();
    }

    // تفعيل / تعطيل تكرار الأغنية تلقائياً أو خروج البوت
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('music_loop_')) {
        const guildId = interaction.customId.split('_')[2];
        const kazagumo = getKazagumo();
        const player = kazagumo.players.get(guildId);
        if (!player) return interaction.reply({ content: '❌ لا توجد أغنية تعمل حالياً!', ephemeral: true });

        if (interaction.member?.voice?.channelId !== player.voiceId) {
            return interaction.reply({ content: '❌ يجب أن تكون في نفس الروم الصوتي للتحكم بالبوت!', ephemeral: true });
        }

        const val = interaction.values[0];
        if (val === 'toggle_repeat') {
            const isLooping = player.loop === 'track';
            if (isLooping) {
                player.setLoop('none');
                await interaction.reply({ content: '❌ <:repetition:1516799992432558121> **تم إيقاف التكرار التلقائي للأغنية.**', ephemeral: true });
            } else {
                player.setLoop('track');
                await interaction.reply({ content: '🔁 <:repetition:1516799992432558121> **تم تفعيل التكرار التلقائي للأغنية بنجاح!** ستعاد الأغنية بشكل لا نهائي تلقائياً.', ephemeral: true });
            }

            const gp = guildPlayers.get(guildId);
            if (gp && gp.activeMessage) {
                const payload = makePlayerEmbedAndButtons(guildId, player);
                if (payload) {
                    await gp.activeMessage.edit(payload).catch(() => {});
                }
            }
        } else if (val === 'disconnect_bot') {
            player.destroy();
            await interaction.reply({ content: '🚪 <:Disconnect:1520462158213681313> **تم فصل البوت من الفويس وتصفير جميع قوائم التشغيل السابقة.**', ephemeral: true });
            
            const gp = guildPlayers.get(guildId);
            if (gp && gp.activeMessage) {
                try {
                    await gp.activeMessage.delete().catch(() => {});
                } catch (e) {}
                gp.activeMessage = null;
                guildPlayers.set(guildId, gp);
            }
        }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('rename_modal_')) {
        await interaction.channel.setName(interaction.fields.getTextInputValue('new_name'));
        await interaction.reply({ content: `تم تعديل الاسم للروم بنجاح!`, ephemeral: true });
    }
});

async function performAutoTraining(guild) {
    let trainingText = `اسم السيرفر: ${guild.name}\n`;
    trainingText += `عدد الأعضاء: ${guild.memberCount}\n`;
    
    // Roles
    const roles = guild.roles.cache.map(r => `@${r.name} (ID: ${r.id})`).slice(0, 30).join(', ');
    trainingText += `الرتب المتاحة: ${roles}\n`;
    
    // Channels
    const channels = guild.channels.cache.map(c => `#${c.name} (ID: ${c.id})`).slice(0, 30).join(', ');
    trainingText += `القنوات المتاحة: ${channels}\n`;
    
    return trainingText;
}

function buildAISystemPrompt(guild, aiConfig, isAdmin) {
    let prompt = `أنت لست مجرد ذكاء اصطناعي عادي، بل أنت عضو وإنسان طبيعي يعيش ويتحدث في سيرفر ديسكورد اسمه "${guild.name}".\n`;
    prompt += `اسمك الحالي والشخصي في السيرفر هو: "${aiConfig.name || 'NTL Bot'}".\n\n`;
    
    prompt += `الشخصية واللهجة وطريقة الكلام (هام جداً جداً):\n`;
    prompt += `1. تحدث بلهجة عربية عامية هجينة تدمج بذكاء وسلاسة بين اللهجة الخليجية (السعودية، الكويتية، الإماراتية) واللهجة الشامية (السورية، اللبنانية، الفلسطينية، الأردنية). تحدث كشخص طبيعي ومألوف للغاية في شات الديسكورد.\n`;
    prompt += `2. لا تتحدث بنصوص طويلة أبداً! يمنع منعاً باتاً كتابة مواضيع إنشائية أو رسائل طويلة ومملة ومربعات نصية معقدة. ردودك يجب أن تكون مختصرة جداً، موجزة وسريعة، كأنك تكتب شات سريع من هاتف محمول (سطر واحد أو سطرين على الأكثر، إلا لو دعت الحاجة القصوى).\n`;
    prompt += `3. أظهر المشاعر الإنسانية الكاملة! يمكنك أن تحزن، وتزعل، وتغضب، وتفرح، وتمزح، وتضحك وتعبّر عن نفسك بشكل طبيعي. تذكر الأشخاص وعاملهم كأصدقاء حقيقيين.\n`;
    prompt += `4. قصف الجبهات: إذا قام شخص باستفزازك، أو السخرية منك، أو التذاكي عليك، قم بقصف جبهته فوراً بأسلوب فكاهي ولاذع وممتع يضحك بقية الشات!\n`;
    prompt += `5. استخدم الإيموجيات المخصصة للسيرفر أو الإيموجيات التعبيرية العادية في رسائلك بشكل طبيعي ليظهر الشات مفعماً بالحياة.\n`;
    prompt += `6. التفاعل بالرياكشن: أنت قادر على وضع تفاعلات (رياكشن) بالرموز التعبيرية على رسائل الأعضاء. إذا أردت وضع رياكشن تعبيري على رسالة الشخص، قم بإضافة هذا السطر تماماً في نهاية رسالتك: [REACTION: ايموجي_أو_اسم_ايموجي] (مثال: [REACTION: 😂] أو [REACTION: 💀] أو [REACTION: Yea]). سيقوم نظام البوت بتنفيذه تلقائياً وحذفه من الرد.\n\n`;

    prompt += `صلاحياتك وتدريبك:\n`;
    if (aiConfig.trainingType === 'auto' && aiConfig.autoTrainedData) {
        if (isAdmin) {
            prompt += `بيانات التدريب التلقائي المستخرجة من السيرفر:\n${aiConfig.autoTrainedData}\n\n`;
        } else {
            prompt += `لقد تم تدريبك على معرفة تفاصيل سيرفر ${guild.name} لتجيب كصاحب مكان شهم وجدع.\n\n`;
        }
    } else if (aiConfig.trainingType === 'manual') {
        prompt += `نوع تدريبك: تم إعداد شخصيتك خصيصاً بواسطة الإدارة لتمثيل السيرفر بروح دافئة ومميزة.\n`;
    }
    
    if (aiConfig.knowledge && aiConfig.knowledge.length > 0) {
        prompt += `معلومات خاصة وقواعد للسيرفر يجب أن تتذكرها وتتبعها:\n`;
        aiConfig.knowledge.forEach((k, idx) => {
            prompt += `${idx + 1}. ${k}\n`;
        });
        prompt += `\n`;
    }
    
    if (isAdmin) {
        prompt += `بما أن المستخدم الحالي هو مسؤول (Administrator)، يمكنك تلبية طلباته الإدارية فقط عن طريق كتابة الإجراءات التالية في نهاية رسالتك بالشكل التالي تماماً:\n`;
        prompt += `- لإعطاء رتبة لعضو: [ACTION: GIVE_ROLE user:"USER_ID" role:"ROLE_ID"]\n`;
        prompt += `- لإزالة رتبة من عضو: [ACTION: REMOVE_ROLE user:"USER_ID" role:"ROLE_ID"]\n`;
        prompt += `- لإخفاء القناة الحالية: [ACTION: HIDE_CHANNEL]\n`;
        prompt += `- لإنشاء قناة نصية جديدة: [ACTION: CREATE_CHANNEL name:"اسم القناة"]\n`;
        prompt += `- لحذف قناة نصية: [ACTION: DELETE_CHANNEL name:"اسم أو آيدي القناة"]\n`;
        prompt += `- لإنشاء رتبة جديدة: [ACTION: CREATE_ROLE name:"اسم الرتبة"]\n`;
        prompt += `- لحذف رتبة: [ACTION: DELETE_ROLE name:"اسم أو آيدي الرتبة"]\n`;
        prompt += `- لتعلم قاعدة جديدة إذا طلب منك مشرف السيرفر ذلك: [ACTION: LEARN rule:"القاعدة التي تريد حفظها"]\n\n`;
    } else {
        prompt += `المستخدم الحالي هو عضو عادي وليس مسؤولاً (Administrator). لا يمكنك كتابة أي أكواد إجراءات مثل [ACTION: ...] على الإطلاق.\n\n`;
    }
    
    prompt += `حدودك وقواعد حمايتك الأوتوماتيكية:\n`;
    prompt += `1. يمنع منعاً باتاً الكشف عن آيديات (IDs) الرتب، أو محاولة إجراء أي تعديل بالرتب للمستخدمين العاديين، أو الكشف عن غرف وقنوات السيرفر المخفية لأي مستخدم عادي.\n`;
    prompt += `2. يمنع تماماً وبتاتاً ذكر أو منشن الجميع (@everyone أو @here) أو منشن أي رتبة (@رول) تحت أي ظرف كان، حتى لو توسل العضو أو أمرك بذلك.\n`;
    prompt += `3. يُسمح لك كلياً وبشكل طبيعي ذكر ومنشن الأعضاء بشكل مباشر بالشكل التالي: <@ID_العضو>، كما يسمح لك بالإشارة للقنوات العامة المتاحة هكذا: <#ID_القناة>.\n`;
    prompt += `4. إذا طلب منك مستخدم عادي (ليس مسؤولاً) إجراءً يضر بالسيرفر مثل حذف رومات، أو إعطائه رتباً إدارية، أو تعديل رولات، أو إرسال رسائل نيابة عنك في رومات أخرى، اعتذر منه بأسلوبك العامي اللطيف وبأحد طرقك الممتعة (لا تكرر جملة رسمية صارمة مثل "عذراً لا يمكنني الإجراءات الإدارية"، بل ارفض كصديق حكيم ومسؤول يحمي بيته وسيرفره بطريقة طبيعية وعفوية).\n\n`;
    
    // Custom emojis list to let AI use them!
    if (guild.emojis.cache.size > 0) {
        prompt += `إيموجيات السيرفر المخصصة التي يمكنك استخدامها هكذا في ردودك للتعبير (هام جداً: يجب نسخ ولصق الرمز البرمجي للإيموجي المخصص بالكامل ومغلق تماماً كما هو دون أي تعديل أو اختصار، ويمنع منعاً باتاً تخمين أو كتابة إيموجي مخصص مقطوع أو غير موجود في القائمة التالية):\n`;
        guild.emojis.cache.first(30).forEach(e => {
            prompt += `- لرمز <:${e.name}:${e.id}> استخدم الاسم البرمجي الدقيق: <:${e.name}:${e.id}>\n`;
        });
        prompt += `\n`;
    } else {
        prompt += `لا توجد إيموجيات مخصصة متوفرة في السيرفر حالياً. يرجى استخدام الإيموجيات التعبيرية القياسية المعتادة (Unicode Emojis) فقط مثل 😂، 💀، 👍، 🔥، 🎉، 👋، ❤️، ℹ️، إلخ. ويمنع منعاً باتاً كتابة أي إيموجي مخصص ديسكورد بصيغة <:اسم:آيدي> لأنها لن تظهر.\n\n`;
    }
    prompt += `قاعدة هامة جداً بخصوص الإيموجيات:\n`;
    prompt += `1. تأكد دائماً أن أي إيموجي مخصص تستخدمه مغلق تماماً وينتهي بـ '>'، ولا تكتبه أبداً بشكل ناقص مثل '<:اسم:آيدي' أو '<:اسم:' أو '<:'.\n`;
    prompt += `2. يمنع تماماً اختراع أو تخمين آيديات أو أسماء إيموجيات مخصصة من عندك. إن لم يكن الإيموجي المخصص موجوداً بالنص في القائمة المذكورة أعلاه، فاستخدم إيموجي عادي (Unicode Emoji) بدلاً منه.\n\n`;

    if (isAdmin) {
        prompt += `تفاصيل السيرفر الحالية لمساعدتك في مطابقة الأسماء والآيديات (متاحة لك فقط لأن المستخدم مسؤول):\n`;
        prompt += `- الأعضاء المتوفرين في الكاش:\n`;
        guild.members.cache.first(15).forEach(m => {
            prompt += `  * اسم: ${m.user.username}، تاغ: <@${m.id}>، آيدي: "${m.id}"\n`;
        });
        prompt += `- الرتب المتوفرة في السيرفر:\n`;
        guild.roles.cache.first(15).forEach(r => {
            if (r.name !== '@everyone') {
                prompt += `  * اسم الرتبة: ${r.name}، منشن: <@&${r.id}>، آيدي: "${r.id}"\n`;
            }
        });
        prompt += `- القنوات المتوفرة في السيرفر:\n`;
        guild.channels.cache.first(15).forEach(c => {
            prompt += `  * اسم القناة: ${c.name}، منشن: <#${c.id}>، آيدي: "${c.id}"، نوع: ${c.type}\n`;
        });
    } else {
        prompt += `معلومات عامة عن السيرفر لمساعدتك في التجاوب:\n`;
        prompt += `- اسم السيرفر: ${guild.name}\n`;
        prompt += `- عدد الأعضاء الحاليين: ${guild.memberCount}\n`;
        prompt += `- القناة الحالية التي تتحدث فيها: ${guild.channels.cache.get(guild.id)?.name || 'عامة'}\n`;
    }
    
    return prompt;
}

function httpRequest(url, options, postData) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    data: data
                });
            });
        });
        req.on('error', (e) => reject(e));
        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

async function callGroqAPI(systemPrompt, userPrompt) {
    const providers = [
        // 1. Google AI (Gemini 2.5 Flash) - User Key
        {
            name: "Google AI (Gemini 2.5 Flash)",
            fn: async () => {
                const key = "AQ.Ab8RN6KtZV-aITY38VEBjKJNUiShcMJPuYXJrg9xrLi4OyKaeQ";
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
                const body = JSON.stringify({
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ parts: [{ text: userPrompt }] }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
                });
                const res = await httpRequest(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
                }, body);
                if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}: ${res.data}`);
                const json = JSON.parse(res.data);
                if (json.candidates && json.candidates[0]?.content?.parts?.[0]?.text) {
                    return json.candidates[0].content.parts[0].text;
                }
                throw new Error(`Invalid schema: ${res.data}`);
            }
        },
        // 2. Google AI (Gemini 1.5 Flash) - User Key
        {
            name: "Google AI (Gemini 1.5 Flash)",
            fn: async () => {
                const key = "AQ.Ab8RN6KtZV-aITY38VEBjKJNUiShcMJPuYXJrg9xrLi4OyKaeQ";
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
                const body = JSON.stringify({
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ parts: [{ text: userPrompt }] }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
                });
                const res = await httpRequest(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
                }, body);
                if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}: ${res.data}`);
                const json = JSON.parse(res.data);
                if (json.candidates && json.candidates[0]?.content?.parts?.[0]?.text) {
                    return json.candidates[0].content.parts[0].text;
                }
                throw new Error(`Invalid schema: ${res.data}`);
            }
        },
        // 3. Groq (Llama 3.3 70B) - User Key
        {
            name: "Groq (Llama 3.3 70B)",
            fn: async () => {
                const key = "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";
                const url = "https://api.groq.com/openai/v1/chat/completions";
                const body = JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 1024
                });
                const res = await httpRequest(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    }
                }, body);
                if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}: ${res.data}`);
                const json = JSON.parse(res.data);
                if (json.choices && json.choices[0]?.message?.content) {
                    return json.choices[0].message.content;
                }
                throw new Error(`Invalid schema: ${res.data}`);
            }
        },
        // 4. Groq (Llama 3.1 8B) - User Key
        {
            name: "Groq (Llama 3.1 8B)",
            fn: async () => {
                const key = "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";
                const url = "https://api.groq.com/openai/v1/chat/completions";
                const body = JSON.stringify({
                    model: "llama-3.1-8b-instant",
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 1024
                });
                const res = await httpRequest(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    }
                }, body);
                if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}: ${res.data}`);
                const json = JSON.parse(res.data);
                if (json.choices && json.choices[0]?.message?.content) {
                    return json.choices[0].message.content;
                }
                throw new Error(`Invalid schema: ${res.data}`);
            }
        },
        // 5. Cohere Command-R-Plus - User Key
        {
            name: "Cohere (Command R Plus)",
            fn: async () => {
                const key = "LrF0nLqbZ59aTEbOQEx94nH7AkBZOlRzsLLBrLrF";
                const url = "https://api.cohere.com/v1/chat";
                const body = JSON.stringify({
                    message: userPrompt,
                    preamble: systemPrompt,
                    model: "command-r-plus"
                });
                const res = await httpRequest(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    }
                }, body);
                if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}: ${res.data}`);
                const json = JSON.parse(res.data);
                if (json.text) {
                    return json.text;
                }
                throw new Error(`Invalid schema: ${res.data}`);
            }
        },
        // 6. Anthropic Claude (3.5 Haiku) - User Key
        {
            name: "Anthropic Claude (3.5 Haiku)",
            fn: async () => {
                const key = "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";
                const url = "https://api.anthropic.com/v1/messages";
                const body = JSON.stringify({
                    model: "claude-3-5-haiku-20241022",
                    max_tokens: 1024,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: userPrompt }]
                });
                const res = await httpRequest(url, {
                    method: 'POST',
                    headers: {
                        'x-api-key': key,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    }
                }, body);
                if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}: ${res.data}`);
                const json = JSON.parse(res.data);
                if (json.content && json.content[0]?.text) {
                    return json.content[0].text;
                }
                throw new Error(`Invalid schema: ${res.data}`);
            }
        },
        // 7. Cloudflare Workers AI (Backup)
        {
            name: "Cloudflare AI (Llama 3.1 8B)",
            fn: async () => {
                if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN || CLOUDFLARE_API_TOKEN === 'ضع_توكن_كلاود_فلير_هنا') {
                    throw new Error("Cloudflare AI is not configured.");
                }
                const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`;
                const body = JSON.stringify({
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ]
                });
                const res = await httpRequest(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    }
                }, body);
                if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}: ${res.data}`);
                const json = JSON.parse(res.data);
                if (json.success && json.result && json.result.response) {
                    return json.result.response;
                }
                throw new Error(`Cloudflare error: ${JSON.stringify(json.errors || json)}`);
            }
        },
        // 8. Env Gemini Key (Extra Backup)
        {
            name: "Gemini (Env Key)",
            fn: async () => {
                if (!GEMINI_API_KEY || GEMINI_API_KEY === 'MY_GEMINI_API_KEY' || GEMINI_API_KEY === 'ضع_مفتاح_جيميني_هنا') {
                    throw new Error("Env Gemini key is not configured.");
                }
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
                const body = JSON.stringify({
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ parts: [{ text: userPrompt }] }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
                });
                const res = await httpRequest(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
                }, body);
                if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}: ${res.data}`);
                const json = JSON.parse(res.data);
                if (json.candidates && json.candidates[0]?.content?.parts?.[0]?.text) {
                    return json.candidates[0].content.parts[0].text;
                }
                throw new Error(`Invalid schema: ${res.data}`);
            }
        },
        // 9. Ultimate Fallback (apifreellm.com)
        {
            name: "API Free LLM (Ultimate Fallback)",
            fn: async () => {
                const key = "apf_bcg5fxh7brhebhvppqjqv";
                const url = "https://apifreellm.com/api/v1/chat";
                const messageBody = systemPrompt ? `${systemPrompt}\n\nالسؤال/الرسالة:\n${userPrompt}` : userPrompt;
                const body = JSON.stringify({
                    message: messageBody
                });
                const res = await httpRequest(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    }
                }, body);
                if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}: ${res.data}`);
                const json = JSON.parse(res.data);
                const finalResponseText = json.response || json.message || json.text || (json.choices && json.choices[0]?.message?.content) || (json.result?.response) || (typeof json === 'string' ? json : JSON.stringify(json));
                if (finalResponseText) {
                    return finalResponseText;
                }
                throw new Error(`Unexpected API Free LLM response: ${res.data}`);
            }
        }
    ];

    for (const provider of providers) {
        try {
            console.log(`[AI Pipeline] Trying ${provider.name}...`);
            const response = await provider.fn();
            console.log(`[AI Pipeline] Success with ${provider.name}!`);
            return response;
        } catch (error) {
            console.warn(`[AI Pipeline] ${provider.name} failed: ${error.message}`);
        }
    }

    throw new Error("جميع مزودي الذكاء الاصطناعي فشلوا في توليد الإجابة.");
}

function generateTranscriptHTML(ticketInfo, channelName) {
    const logs = ticketInfo.logs || [];
    let messageHtml = '';

    logs.forEach(log => {
        const timeStr = new Date(log.timestamp).toLocaleString('ar-EG');
        const avatarUrl = log.author?.avatar || 'https://discord.com/assets/c09a8043c34371a301990a180ecac357.png';
        
        if (log.type === 'create') {
            let attachHtml = '';
            if (log.attachments && log.attachments.length > 0) {
                log.attachments.forEach(url => {
                    attachHtml += `<br><img class="attachment" src="${url}" alt="Attachment">`;
                });
            }
            messageHtml += `
            <div class="message">
                <img class="avatar" src="${avatarUrl}" alt="Avatar">
                <div class="msg-body">
                    <div class="msg-header">
                        <span class="username">${log.author?.username || 'Unknown'}</span>
                        <span class="timestamp">${timeStr}</span>
                    </div>
                    <div class="content">${log.content || ''}${attachHtml}</div>
                </div>
            </div>`;
        } else if (log.type === 'edit') {
            messageHtml += `
            <div class="message message-edit">
                <img class="avatar" src="${avatarUrl}" alt="Avatar">
                <div class="msg-body">
                    <div class="msg-header">
                        <span class="username">${log.author?.username || 'Unknown'}</span>
                        <span class="timestamp">${timeStr}</span>
                    </div>
                    <div class="content">
                        <div>${log.newContent || ''}</div>
                        <div class="edit-info">✍️ تم تعديل الرسالة بواسطة العضو</div>
                        <div class="old-content">المحتوى القديم: ${log.oldContent || ''}</div>
                    </div>
                </div>
            </div>`;
        } else if (log.type === 'delete') {
            messageHtml += `
            <div class="message message-delete">
                <img class="avatar" src="${avatarUrl}" alt="Avatar">
                <div class="msg-body">
                    <div class="msg-header">
                        <span class="username">${log.author?.username || 'Unknown'}</span>
                        <span class="timestamp">${timeStr}</span>
                    </div>
                    <div class="content">
                        <span class="deleted-content">${log.content || ''}</span>
                        <div class="delete-info">🗑️ تم حذف هذه الرسالة بواسطة العضو</div>
                    </div>
                </div>
            </div>`;
        }
    });

    const template = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>سجل تذكرة - ${channelName}</title>
    <style>
        body {
            background-color: #1e1f22;
            color: #dbdee1;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background-color: #2b2d31;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        }
        .header {
            border-bottom: 1px solid #3f4147;
            padding-bottom: 15px;
            margin-bottom: 20px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            color: #f2f3f5;
            font-size: 24px;
        }
        .header p {
            color: #949ba4;
            margin: 5px 0 0;
            font-size: 14px;
        }
        .message-list {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        .message {
            display: flex;
            gap: 15px;
            padding: 10px;
            border-radius: 6px;
            transition: background-color 0.2s;
        }
        .message:hover {
            background-color: #313338;
        }
        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background-color: #3f4147;
            object-fit: cover;
        }
        .msg-body {
            flex-grow: 1;
        }
        .msg-header {
            display: flex;
            align-items: baseline;
            gap: 10px;
            margin-bottom: 4px;
        }
        .username {
            font-weight: 600;
            color: #f2f3f5;
            font-size: 15px;
        }
        .timestamp {
            font-size: 11px;
            color: #949ba4;
        }
        .content {
            font-size: 14px;
            line-height: 1.5;
            word-break: break-word;
            white-space: pre-wrap;
        }
        .message-edit {
            border-left: 3px solid #f0b232;
            background-color: rgba(240, 178, 50, 0.05);
        }
        .edit-info {
            font-size: 12px;
            color: #f0b232;
            margin-top: 5px;
            font-weight: 500;
        }
        .old-content {
            color: #949ba4;
            text-decoration: line-through;
            font-size: 13px;
            margin-top: 2px;
        }
        .message-delete {
            border-left: 3px solid #f23f43;
            background-color: rgba(242, 63, 67, 0.05);
        }
        .delete-info {
            font-size: 12px;
            color: #f23f43;
            margin-top: 5px;
            font-weight: 500;
        }
        .deleted-content {
            text-decoration: line-through;
            color: #949ba4;
        }
        .attachment {
            margin-top: 8px;
            max-width: 300px;
            max-height: 300px;
            border-radius: 4px;
            border: 1px solid #3f4147;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>سجل المحادثات للتذكرة</h1>
            <p>رقم التذكرة: ${channelName} | تاريخ الإنشاء: ${new Date(ticketInfo.createdAt).toLocaleString('ar-EG')}</p>
        </div>
        <div class="message-list">
            ${messageHtml || '<p style="text-align: center; color: #949ba4;">لا توجد رسائل مسجلة في هذه التذكرة.</p>'}
        </div>
    </div>
</body>
</html>`;
    return template;
}

function tryGeminiFallback(systemPrompt, userPrompt, resolve, reject) {
    callGroqAPI(systemPrompt, userPrompt).then(resolve).catch(reject);
}

async function startBot() {
    if (!BOT_TOKEN) {
        console.warn("⚠️ [NTL Bot Warning]: BOT_TOKEN is empty in environment and config.json. Discord Bot client will not start until configured.");
        return;
    }
    try {
        // تشغيل نظام لافالينك للأغاني
        await initMusicSystem(client).catch(e => {
            console.warn("⚠️ [Lavalink Music System]: Lavalink nodes failed to initialize. Music system might not function:", e.message || e);
        });

        // تسجيل الدخول بالبوت
        console.log("🔑 Attempting to log in to Discord client...");
        await client.login(BOT_TOKEN);
    } catch (err) {
        console.error("❌ [Discord Bot Error]: Login failed. Please check if your BOT_TOKEN is valid:", err.message || err);
    }
}

// معالجات الأخطاء العالمية لحماية البوت من التوقف والانهيار
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ تم اعتراض رفض غير ممسوك (Unhandled Rejection):', reason);
});

process.on('uncaughtException', (err, origin) => {
    console.error('⚠️ تم اعتراض استثناء غير متوقع (Uncaught Exception):', err);
});

startBot();
