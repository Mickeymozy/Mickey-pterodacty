const {
  Client,
  Collection,
  GatewayIntentBits,
  ActivityType,
} = require("discord.js");
const { ClusterClient } = require("discord-hybrid-sharding");
const mongoose = require("mongoose");
const { readdirSync } = require("fs");
const settings = require("../../settings");
const Util = require("./Util");

class PteroBot extends Client {
  constructor() {
    super({
      intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.GuildMembers,
          GatewayIntentBits.MessageContent
      ],
      allowedMentions: { parse: ["users", "roles"], repliedUser: false },
      presence: {
        activities: [
          {
            name: "panel.leonodes.xyz",
            type: ActivityType.Watching,
          },
        ],
      },
      shards: ClusterClient.getInfo().SHARD_LIST,
      shardCount: ClusterClient.getInfo().TOTAL_SHARDS,
    });

    this.cluster = new ClusterClient(this);
    this.events = new Collection();
    this.commands = new Collection();
    this.settings = settings;
    this.util = new Util(this);
  }

  async build() {
    try {
      // Load commands
      const commandFiles = readdirSync("./src/commands", {
        withFileTypes: true,
      });
      for (const category of commandFiles.filter((dir) => dir.isDirectory())) {
        const commands = readdirSync(`./src/commands/${category.name}`);
        for (const command of commands) {
          const cmd = require(`../commands/${category.name}/${command}`);
          this.commands.set(command.split(".")[0], {
            ...cmd,
            category: category.name,
          });
        }
      }

      // Load events
      const eventFiles = readdirSync("./src/events");
      for (const event of eventFiles) {
        const eventName = event.split(".")[0];
        const eventHandler = require(`../events/${event}`);
        this.events.set(eventName, eventHandler);
        this[eventName === "ready" ? "once" : "on"](eventName, (...args) =>
          eventHandler(this, ...args)
        );
      }

      // MongoDB connection
      await mongoose.connect(this.settings.MongoDB, {
        maxPoolSize: 6,
        minPoolSize: 1,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });

      await this.login(this.settings.TOKEN);

      if (this.cluster.id === 0) {
        console.log(
          `Loaded ${this.commands.size} commands and ${this.events.size} events`
        );
      }

      this.once("ready", async () => {
      });

      return this;
    } catch (error) {
      console.error("Failed to build bot:", error);
      process.exit(1);
    }
  }

  async createMessage(channelId, options) {
    return this.rest
      .post(`/channels/${channelId}/messages`, {
        body: options,
        auth: true,
      })
      .then((data) => new this.options.Message(this, data));
  }

  async deleteMessage(channelId, messageId) {
    return this.rest.delete(`/channels/${channelId}/messages/${messageId}`);
  }

  async editMessage(channelId, messageId, options) {
    return this.rest
      .patch(`/channels/${channelId}/messages/${messageId}`, {
        body: options,
        auth: true,
      })
      .then((data) => new this.options.Message(this, data));
  }
}

module.exports = PteroBot;