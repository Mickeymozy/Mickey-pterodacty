const { REST, Routes, ApplicationCommandType } = require("discord.js");
const api = require("../structures/Ptero");
const clientApi = require("../structures/ClientPtero");
const os = require("os");
const fs = require("fs");
const path = require("path");

// === CONFIG ===
const PANEL_URL = "https://panel.leonodes.xyz/server/";
const GUILD_ID = "1374783116291477524";
const ANNOUNCE_CHANNEL_ID = "1387303798153678930";
const NO_SERVER_ROLE_ID = "1386310918442455140";
const WHITELISTED_UUIDS = [
  "c47c3ff8-7076-449d-961e-ca1b3f3c0ca3",
  "702f85a2-6dea-4ac8-bf76-c2cd48567594",
  "155da30d-d69e-488c-b43b-736e983ea9f4",
  "1bc089ff-1355-4187-8c86-3a918636cf06",
  "6df028d4-975f-4efb-83d1-2c8e613c10a4",
  "3d64f61d-be76-4f83-a5c2-26112dc8f897",
  "151f6d76-04ba-422e-abc8-d80588151e59",
  "25b9f9a2-703c-41ff-a9de-6574187af462"
];
const MAX_SLOTS = 50;
const RECLAIM_STATE_FILE = path.join(__dirname, "../data/reclaimState.json");
const ANNOUNCE_COOLDOWN = 6 * 60 * 60 * 1000; // 6 hours

// === LOAD OR INITIALIZE STATE ===
let reclaimState = { announced: false, lastAnnounced: 0 };
if (fs.existsSync(RECLAIM_STATE_FILE)) {
  try {
    Object.assign(reclaimState, JSON.parse(fs.readFileSync(RECLAIM_STATE_FILE)));
  } catch (err) {
    console.error("[READY] Failed to parse reclaimState.json:", err);
  }
}
function saveReclaimState() {
  try {
    fs.writeFileSync(RECLAIM_STATE_FILE, JSON.stringify(reclaimState, null, 2));
  } catch (err) {
    console.error("[READY] Failed to save reclaimState.json:", err);
  }
}

// === HELPERS ===
const sleep = ms => new Promise(r => setTimeout(r, ms));

// === STOP ALL IF MEMORY FULL ===
async function stopAllIfMemoryFull() {
  const usedPercent = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;
  if (usedPercent < 90) return;

  console.log(`[MEMORY] Usage at ${usedPercent.toFixed(1)}% — stopping all non-whitelisted servers`);
  let page = 1;
  while (true) {
    const res = await api.get(`/servers?page=${page}&per_page=100`);
    const servers = res.data.data || [];
    if (!servers.length) break;

    for (const { attributes: s } of servers) {
      if (WHITELISTED_UUIDS.includes(s.uuid)) continue;
      const state = (await clientApi.get(`/servers/${s.identifier}/resources`))
        .data.attributes.current_state;
      if (state === "running" || state === "starting") {
        await clientApi.post(`/servers/${s.identifier}/power`, { signal: "stop" });
        console.log(`→ stopped ${s.name} (${s.uuid})`);
      }
    }
    page++;
  }
}

// === ROLE ASSIGNMENT & SLOT ANNOUNCEMENT ===
async function assignRolesAndAnnounce(client) {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  // 1) Build map of panelUserID → DiscordID
  const panelUsers = new Map();
  for (let page = 1;; page++) {
    const users = (await api.get(`/users?page=${page}&per_page=100`)).data.data;
    if (!users.length) break;
    for (const u of users) {
      const id = u.attributes.username;
      if (/^\d{17,20}$/.test(id)) panelUsers.set(u.attributes.id, id);
    }
  }

  // 2) Count non-whitelisted servers & collect owners
  const owners = new Set();
  let totalNonWL = 0;
  for (let page = 1;; page++) {
    const servers = (await api.get(`/servers?page=${page}&per_page=100`)).data.data;
    if (!servers.length) break;
    for (const sItem of servers) {
      const s = sItem.attributes;
      if (!WHITELISTED_UUIDS.includes(s.uuid)) totalNonWL++;
      const discordId = panelUsers.get(s.user);
      if (discordId) owners.add(discordId);
    }
  }

  // 3) Sync roles
  for (const discordId of new Set(panelUsers.values())) {
    try {
      const member = await guild.members.fetch(discordId);
      const hasRole = member.roles.cache.has(NO_SERVER_ROLE_ID);
      const owns = owners.has(discordId);

      if (!owns && !hasRole) {
        await member.roles.add(NO_SERVER_ROLE_ID);
        console.log(`→ role added to ${member.user.tag}`);
        await sleep(2000);
      }
      if (owns && hasRole) {
        await member.roles.remove(NO_SERVER_ROLE_ID);
        console.log(`→ role removed from ${member.user.tag}`);
        await sleep(2000);
      }
    } catch {
      // member might not be in guild
    }
  }

  // 4) Announce slots if needed
  const freeSlots = MAX_SLOTS - totalNonWL;
  const now = Date.now();
  if (
    freeSlots > 0 &&
    (!reclaimState.announced || now - reclaimState.lastAnnounced > ANNOUNCE_COOLDOWN)
  ) {
    const chan = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);
    if (chan) {
      await chan.send({
        content: `<@&${NO_SERVER_ROLE_ID}>`,
        embeds: [{
          color: 0x00FF00,
          title: "🎉 Server Slots Available!",
          description: `${freeSlots} slot(s) are now **free** — whitelisted users without a server can claim one.`,
          footer: { text: "LeoNodes Hosting" },
          timestamp: new Date().toISOString()
        }]
      });
      console.log(`→ announced ${freeSlots} free slot(s)`);
      reclaimState.announced = true;
      reclaimState.lastAnnounced = now;
      saveReclaimState();
    }
  } else if (freeSlots <= 0 && reclaimState.announced) {
    reclaimState.announced = false;
    saveReclaimState();
  }
}

// === MODULE INIT ===
module.exports = async (client) => {
  console.log(`Cluster #${client.cluster.id} ready.`);

  if (client.cluster.id !== 0) return;

  // register slash commands
  const rest = new REST({ version: "10" }).setToken(client.token);
  const cmds = client.commands
    .filter(c => c.category !== "Owner")
    .map(c => ({
      name: c.name,
      description: c.description,
      options: c.options || [],
      type: ApplicationCommandType.ChatInput,
      dmPermission: false
    }));
  await rest.put(Routes.applicationCommands(client.user.id), { body: cmds });

  // schedule loops
  setInterval(stopAllIfMemoryFull, 60_000);
  setInterval(() => assignRolesAndAnnounce(client), 60_000);
};
