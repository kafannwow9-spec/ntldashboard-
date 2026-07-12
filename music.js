const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { Connectors } = require('shoukaku');
const { Kazagumo } = require('kazagumo');
const fs = require('fs');

const dbPath = './tickets_db.json';
function getDB() { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); }
function saveDB(data) { fs.writeFileSync(dbPath, JSON.stringify(data, null, 4)); }

class TextDisplayBuilder {
    constructor() {
        this.data = {
            type: 10,
            content: ''
        };
    }
    setContent(content) {
        this.data.content = content;
        return this;
    }
    toJSON() {
        return this.data;
    }
}

class SeparatorBuilder {
    constructor() {
        this.data = {
            type: 14,
            divider: true
        };
    }
    setDivider(divider) {
        this.data.divider = divider;
        return this;
    }
    toJSON() {
        return this.data;
    }
}

class SectionBuilder {
    constructor() {
        this.data = {
            type: 9,
            components: [],
            accessory: null
        };
    }
    addTextDisplayComponents(...callbacks) {
        for (const callback of callbacks) {
            const builder = new TextDisplayBuilder();
            callback(builder);
            this.data.components.push(builder.toJSON());
        }
        return this;
    }
    setButtonAccessory(callback) {
        const builder = new ButtonBuilder();
        callback(builder);
        this.data.accessory = typeof builder.toJSON === 'function' ? builder.toJSON() : builder;
        return this;
    }
    toJSON() {
        const json = { ...this.data };
        if (!json.accessory) delete json.accessory;
        return json;
    }
}

class ActionRowBuilderV2 {
    constructor() {
        this.data = {
            type: 1,
            components: []
        };
    }
    setComponents(...components) {
        this.data.components = components.map(c => typeof c.toJSON === 'function' ? c.toJSON() : c);
        return this;
    }
    toJSON() {
        return this.data;
    }
}

class ContainerBuilder {
    constructor() {
        this.data = {
            type: 17,
            components: [],
            accent_color: null
        };
    }
    setAccentColor(color) {
        this.data.accent_color = color;
        return this;
    }
    addTextDisplayComponents(callback) {
        const builder = new TextDisplayBuilder();
        callback(builder);
        this.data.components.push(builder.toJSON());
        return this;
    }
    addActionRowComponents(callback) {
        const builder = new ActionRowBuilderV2();
        callback(builder);
        this.data.components.push(builder.toJSON());
        return this;
    }
    addSeparatorComponents(callback) {
        const builder = new SeparatorBuilder();
        callback(builder);
        this.data.components.push(builder.toJSON());
        return this;
    }
    addSectionComponents(callback) {
        const builder = new SectionBuilder();
        callback(builder);
        this.data.components.push(builder.toJSON());
        return this;
    }
    toJSON() {
        const json = { ...this.data };
        if (json.accent_color === null) delete json.accent_color;
        return json;
    }
}

let kazagumo;
const guildPlayers = new Map();

/**
 * Generates visual player embeds and control buttons.
 * If there are songs in the queue, it returns two embeds:
 * 1. Current song embed
 * 2. Queue list embed
 */
function makePlayerEmbedAndButtons(guildId, player) {
    if (!player) return null;
    const currentTrack = player.queue.current;
    if (!currentTrack) return null;

    const requesterMention = currentTrack.requester?.id ? `<@${currentTrack.requester.id}>` : 'غير معروف';

    // 1. Current Song Embed
    const currentEmbed = new EmbedBuilder()
        .setColor('#2b2d31')
        .setTitle('Synced Feedback')
        .setDescription(`**<:Angham:1520206608716533852> | ${currentTrack.title} مع ${currentTrack.author || 'Unknown'}**`);

    if (currentTrack.thumbnail) {
        currentEmbed.setThumbnail(currentTrack.thumbnail);
    }

    const embeds = [currentEmbed];

    // 2. Queue Embed (only if there are songs in the queue)
    if (player.queue.length > 0) {
        const queueEmbed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('Synced Feedback - قائمة الانتظار');
        
        const desc = player.queue.map((t, idx) => `**${idx + 1}. ${t.title} - ${t.author || 'Unknown'}** (طلب: <@${t.requester?.id || ''}>)`).join('\n');
        queueEmbed.setDescription(desc);

        const nextTrack = player.queue[0];
        if (nextTrack && nextTrack.thumbnail) {
            queueEmbed.setThumbnail(nextTrack.thumbnail);
        } else if (currentTrack.thumbnail) {
            queueEmbed.setThumbnail(currentTrack.thumbnail);
        }

        embeds.push(queueEmbed);
    }

    // Buttons Row
    const buttonsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`music_prev_${guildId}`).setEmoji('1520207287761899682').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`music_pause_${guildId}`).setEmoji('1516765083814989884').setStyle(player.paused ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`music_next_${guildId}`).setEmoji('1516765495921999993').setStyle(ButtonStyle.Secondary)
    );

    // Select Menu Row
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`music_loop_${guildId}`)
        .setPlaceholder('خيارات التشغيل والتحكم...')
        .addOptions([
            {
                label: 'repetition',
                value: 'toggle_repeat',
                emoji: '1516799992432558121',
                description: player.loop === 'track' ? 'تعطيل التكرار التلقائي للأغنية' : 'تفعيل التكرار التلقائي للأغنية'
            },
            {
                label: 'disconnect',
                value: 'disconnect_bot',
                emoji: '1520462158213681313',
                description: 'مغادرة الروم الصوتي وتصفير قائمة الانتظار بالكامل'
            }
        ]);

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);

    return { 
        embeds, 
        components: [buttonsRow, selectRow]
    };
}

async function initMusicSystem(client) {
    console.log("🔄 جاري جلب أفضل سيرفرات Lavalink للسرعة القصوى...");
    let nodes = [];

    const stableNodes = [
        {
            name: 'Lexnet-V4',
            url: 'lavalink.lexnet.cc:443',
            auth: 'lexnetlavalink',
            secure: true
        },
        {
            name: 'Gider-V4',
            url: 'lavalink.gider.xyz:443',
            auth: 'giderlavalink',
            secure: true
        }
    ];

    const blocklist = ['serenetia.com', 'lava.link'];

    try {
        const response = await fetch('https://lavalink-list.ajieblogs.eu.org/SSL');
        const data = await response.json();

        const validHeaderRegex = /^[\x20-\x7E]+$/;

        // تصفية واختيار أفضل سيرفرات لافالينك v4 مع استبعاد السيرفرات المتوقفة
        const dynamicNodes = data
            .filter(node => {
                if (node.version !== 'v4' || !node.password || !validHeaderRegex.test(node.password)) return false;
                const host = (node.host || '').toLowerCase();
                return !blocklist.some(blocked => host.includes(blocked));
            })
            .slice(0, 3) 
            .map(node => ({
                name: node.identifier || node['unique-id'] || `Node-${node.host}`,
                url: `${node.host}:${node.port}`,
                auth: node.password,
                secure: node.secure === true || node.secure === 'true' || node.port === 443
            }));

        nodes = [...stableNodes, ...dynamicNodes];
        console.log(`✅ تم الاتصال وتجهيز (${nodes.length}) سيرفرات لافالينك.`);
    } catch (error) {
        console.log("⚠️ فشل جلب السيرفرات، سيتم تشغيل السيرفرات الموثوقة الاحتياطية.");
        nodes = stableNodes;
    }

    kazagumo = new Kazagumo({
        plugins: [],
        defaultSearchEngine: 'soundcloud', 
        send: (id, payload) => {
            const guild = client.guilds.cache.get(id);
            if (guild) guild.shard.send(payload);
        }
    }, new Connectors.DiscordJS(client), nodes, {
        moveOnDisconnect: true,
        reconnectTries: 2,         
        reconnectInterval: 2000,   
        restTimeout: 3000          
    });

    let readyNodes = new Set();
    kazagumo.shoukaku.on('ready', (name) => {
        if (!readyNodes.has(name)) {
            console.log(`🚀 متصل وجاهز بسيرفر لافالينك: [ ${name} ]`);
            readyNodes.add(name);
        }
    });

    kazagumo.shoukaku.on('error', (name, error) => {
        readyNodes.delete(name);
        console.error(`⚠️ خطأ في سيرفر لافالينك [ ${name} ]:`, error.message || error);
    });

    kazagumo.shoukaku.on('close', (name) => {
        readyNodes.delete(name);
        console.log(`🔌 تم قطع الاتصال بسيرفر لافالينك: [ ${name} ]`);
    });

    kazagumo.on('playerStart', async (player, track) => {
        clearIdleTimeout(player);
        const guildId = player.guildId;
        const gp = guildPlayers.get(guildId) || { history: [], activeMessage: null };
        const payload = makePlayerEmbedAndButtons(guildId, player);
        if (!payload) return;

        const channel = client.channels.cache.get(player.textId);
        if (channel) {
            try {
                if (gp.activeMessage) {
                    if (player.queue.length > 0) {
                        // If other tracks exist in the queue, edit the active message directly
                        await gp.activeMessage.edit(payload).catch(() => {});
                    } else {
                        // If queue is empty, delete the old message and send a fresh one
                        await gp.activeMessage.delete().catch(() => {});
                        const msg = await channel.send(payload);
                        gp.activeMessage = msg;
                        guildPlayers.set(guildId, gp);
                    }
                } else {
                    const msg = await channel.send(payload);
                    gp.activeMessage = msg;
                    guildPlayers.set(guildId, gp);
                }
            } catch (e) {
                console.error("Error in playerStart activeMessage handling:", e);
                // Fallback: send as fresh message
                try {
                    const msg = await channel.send(payload);
                    gp.activeMessage = msg;
                    guildPlayers.set(guildId, gp);
                } catch (err) {}
            }
        }
    });

    const handleQueueEnd = async (player) => {
        const guildId = player.guildId;
        const gp = guildPlayers.get(guildId);
        if (gp && gp.activeMessage) {
            try {
                await gp.activeMessage.edit({ components: [] }).catch(() => {});
            } catch (e) {}
            gp.activeMessage = null;
            guildPlayers.set(guildId, gp);
        }
        const channel = client.channels.cache.get(player.textId);
        if (channel) {
            await channel.send('🎵 انتهت جميع الأغاني في قائمة الانتظار.').catch(() => {});
        }
        startIdleTimeout(player, client);
    };

    kazagumo.on('queueEnd', handleQueueEnd);
    kazagumo.on('playerEmpty', handleQueueEnd);

    kazagumo.on('playerCreate', (player) => {
        startIdleTimeout(player, client);
    });

    kazagumo.on('playerDestroy', (player) => {
        clearIdleTimeout(player);
    });

    // Voice State Update Event - Leaves the voice channel automatically if everyone else leaves
    client.on('voiceStateUpdate', async (oldState, newState) => {
        const player = kazagumo?.players?.get(oldState.guild.id);
        if (!player) return;

        const botChannelId = player.voiceId;
        if (!botChannelId) return;

        const channel = oldState.guild.channels.cache.get(botChannelId);
        if (!channel) return;

        // Count members who are not bots
        const nonBotMembers = channel.members.filter(m => !m.user.bot);
        if (nonBotMembers.size === 0) {
            player.destroy();
            const textChannel = oldState.guild.channels.cache.get(player.textId);
            if (textChannel) {
                await textChannel.send('🚪 غادرت الروم الصوتي لعدم وجود أعضاء فيه.').catch(() => {});
            }
        }
    });
}

function clearIdleTimeout(player) {
    if (player.idleTimeout) {
        clearTimeout(player.idleTimeout);
        player.idleTimeout = null;
    }
}

function startIdleTimeout(player, client) {
    clearIdleTimeout(player);
    player.idleTimeout = setTimeout(async () => {
        try {
            const guildId = player.guildId;
            const textId = player.textId;
            const currentP = player.kazagumo?.players?.get(guildId);
            if (currentP) {
                currentP.destroy();
                const textChannel = client.channels.cache.get(textId);
                if (textChannel) {
                    await textChannel.send('🚪 تم مغادرة الروم الصوتي بسبب عدم تشغيل أي أغنية لمدة 3 دقائق.').catch(() => {});
                }
            }
        } catch (e) {
            console.error('Error in idle timeout:', e);
        }
    }, 3 * 60 * 1000); // 3 minutes
}

module.exports = {
    initMusicSystem,
    makePlayerEmbedAndButtons,
    getKazagumo: () => kazagumo,
    guildPlayers,
    ContainerBuilder
};
