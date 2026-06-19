const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const api = require("../../structures/Ptero");

const bannedUsers = ["1332006483600347157"];


const whitelistedServers = [
 "c47c3ff8-7076-449d-961e-ca1b3f3c0ca3",
  "702f85a2-6dea-4ac8-bf76-c2cd48567594",
  "155da30d-d69e-488c-b43b-736e983ea9f4",
  "1bc089ff-1355-4187-8c86-3a918636cf06",
  "6df028d4-975f-4efb-83d1-2c8e613c10a4",
  "3d64f61d-be76-4f83-a5c2-26112dc8f897",
  "151f6d76-04ba-422e-abc8-d80588151e59",
  "25b9f9a2-703c-41ff-a9de-6574187af462"
];

const tiers = [   
  { name: "Premium", cpu: 150, memory: 4096, disk: 5120, max: 5 },
  { name: "Free", cpu: 50, memory: 512, disk: 1024, max:  45 },
];


const eggs = {
  nodejs: {
    id: 16,
    name: "Node.js",
    docker_image: "ghcr.io/parkervcp/yolks:nodejs_21",
    startup: `if [[ -d .git ]] && [[ "$AUTO_UPDATE" == "1" ]]; then git pull; fi; if [[ ! -z "$NODE_PACKAGES" ]]; then /usr/local/bin/npm install $NODE_PACKAGES; fi; if [[ ! -z "$UNNODE_PACKAGES" ]]; then /usr/local/bin/npm uninstall $UNNODE_PACKAGES; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; if [[ "$MAIN_FILE" == "*.js" ]]; then /usr/local/bin/node "/home/container/$MAIN_FILE" $NODE_ARGS; else /usr/local/bin/ts-node --esm "/home/container/$MAIN_FILE" $NODE_ARGS; fi`,
    environment: {
      USER_UPLOAD: "0",
      MAIN_FILE: "index.js",
      AUTO_UPDATE: "1",
      STARTUP_CMD: "npm start",
    },
  },
  python: {
    id: 27,
    name: "Python",
    docker_image: "ghcr.io/parkervcp/yolks:python_3.10",
    startup: `if [[ -d .git ]] && [[ "$AUTO_UPDATE" == "1" ]]; then git pull; fi; if [[ ! -z "$PY_PACKAGES" ]]; then pip install -U --prefix .local $PY_PACKAGES; fi; if [[ -f /home/container/$REQUIREMENTS_FILE ]]; then pip install -U --prefix .local -r $REQUIREMENTS_FILE; fi; /usr/local/bin/python /home/container/$PY_FILE`,
    environment: {
      USER_UPLOAD: "0",
      PY_FILE: "main.py",
      REQUIREMENTS_FILE: "requirements.txt",
      AUTO_UPDATE: "1",
      STARTUP_CMD: "python3 main.py",
    },
  },
  java: {
    id: 28,
    name: "Java",
    docker_image: "ghcr.io/parkervcp/yolks:java_17",
    startup: `java -Dterminal.jline=false -Dterminal.ansi=true -jar $JARFILE`,
    environment: {
      USER_UPLOAD: "0",
      JARFILE: "server.jar",
      AUTO_UPDATE: "1",
      STARTUP_CMD: "java -jar server.jar",
    },
  },
};

async function getUserByDiscordId(discordId) {
  let page = 1;
  while (true) {
    const res = await api.get(`/users?page=${page}&per_page=100`);
    const users = res.data.data || [];
    if (users.length === 0) break;

    const foundUser = users.find(u => u.attributes.username === discordId);
    if (foundUser) return foundUser;
    page++;
  }
  return null;
}

async function getCurrentTierUsage() {
  const usage = { Premium: 0, Free: 0 };
  let page = 1;

  while (true) {
    const res = await api.get(`/servers?page=${page}&per_page=100`);
    const servers = res.data.data || [];
    if (servers.length === 0) break;

    for (const s of servers) {
      const uuid = s.attributes.uuid;
      if (whitelistedServers.includes(uuid)) continue;

      const { cpu, memory, disk } = s.attributes.limits;
      for (const tier of tiers) {
        if (cpu === tier.cpu && memory === tier.memory && disk === tier.disk) {
          usage[tier.name]++;
          break;
        }
      }
    }

    page++;
  }

  return usage;
}

async function userHasServer(userId) {
  let page = 1;
  while (true) {
    const res = await api.get(`/servers?page=${page}&per_page=100`);
    const servers = res.data.data || [];
    if (servers.length === 0) break;

    for (const server of servers) {
      if (
        server.attributes.user === userId &&
        !whitelistedServers.includes(server.attributes.uuid)
      ) {
        return true;
      }
    }

    page++;
  }

  return false;
}

module.exports = {
  name: "create",
  description: "Create a server from available free slots",
  options: [
    {
      name: "egg",
      description: "Choose server type (Node.js, Python, Java)",
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: [
        { name: "Node.js", value: "nodejs" },
        { name: "Python", value: "python" },
        { name: "Java", value: "java" },
      ],
    },
    {
      name: "servername",
      description: "Name your server",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],

  run: async ({ client, context }) => {
    const discordId = context.user.id;

    if (bannedUsers.includes(discordId)) {
      return context.createMessage({ content: "🚫 You are banned from creating new servers." });
    }

    const eggKey = context.options.getString("egg");
    const serverName = context.options.getString("servername");
    const egg = eggs[eggKey];
    if (!egg) return context.createMessage({ content: "❌ Invalid egg selection." });

    const pteroUser = await getUserByDiscordId(discordId);
    if (!pteroUser) {
      return context.createMessage({ content: "❌ No Pterodactyl user linked. Please register first." });
    }

    const alreadyHasServer = await userHasServer(pteroUser.attributes.id);
    if (alreadyHasServer) {
      return context.createMessage({
        content: "⚠️ You already own a server. You can only have one server per account.",
      });
    }

    const tierUsage = await getCurrentTierUsage();
    let selectedTier = null;
    for (const tier of tiers) {
      if (tierUsage[tier.name] < tier.max) {
        selectedTier = tier;
        break;
      }
    }

    if (!selectedTier) {
      return context.createMessage({
        content: "⚠️ All tier slots are currently full. Please try again later.",
      });
    }

    try {
      const res = await api.post("/servers", {
        name: serverName,
        user: pteroUser.attributes.id,
        egg: egg.id,
        docker_image: egg.docker_image,
        startup: egg.startup,
        environment: egg.environment,
        limits: {
          memory: selectedTier.memory,
          swap: 0,
          disk: selectedTier.disk,
          io: 500,
          cpu: selectedTier.cpu,
          oom_disabled: false,
        },
        feature_limits: {
          databases: 0,
          backups: 1,
          allocations: 1,
        },
        deploy: {
          locations: [1],
          dedicated_ip: false,
          port_range: [],
        },
        start_on_completion: true,
      });

      return context.createMessage({
        embeds: [
          new EmbedBuilder()
            .setColor("Green")
            .setTitle("✅ Server Created")
            .setDescription(
              `🖥️ **Name:** \`${serverName}\`\n🍳 **Type:** \`${egg.name}\`\n📦 **Tier:** \`${selectedTier.name}\`\n🔗 [View on Panel](https://panel.leonodes.xyz/server/${res.data.attributes.identifier})`
            ),
        ],
      });
    } catch (err) {
      console.error("Error creating server:", err.response?.data || err.message || err);
      return context.createMessage({ content: "❌ Failed to create server. Please try again later." });
    }
  },
};
