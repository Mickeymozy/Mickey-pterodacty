const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const api = require("./Ptero");

class Util {
  constructor(client) {
    this.client = client;
  }

async isPanelUserExists(pteroId) {
  try {
    const res = await api.get(`/users/${pteroId}`);
    return res?.data?.object === "user";
  } catch (e) {
    if (e.response?.status === 404) return false;
    console.error("Error checking panel user:", e);
    return false;
  }
}


  async parseDuration(duration) {
    const match = duration?.trim().match(/^(\d+)(s|m|h|d)$/);
    if (!match) return null;

    const [, amount, unit] = match;
    const seconds = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    }[unit];

    return parseInt(amount) * seconds;
  }

  async paginate(context, embeds) {
    let currentPage = 0;
    const buttons = [
      ["⏮️", "1", ButtonStyle.Primary, true],
      ["⏪", "2", ButtonStyle.Secondary, true],
      ["⏩", "3", ButtonStyle.Secondary, false],
      ["⏭️", "4", ButtonStyle.Primary, false],
    ].map(([emoji, id, style, disabled]) =>
      new ButtonBuilder()
        .setCustomId(id)
        .setEmoji(emoji)
        .setStyle(style)
        .setDisabled(disabled)
    );

    const row = new ActionRowBuilder().addComponents(buttons);
    const message = await (context instanceof this.client.options.Message
      ? context.channel.send({ embeds: [embeds[0]], components: [row] })
      : context.followUp({ embeds: [embeds[0]], components: [row] }));

    const collector = message.createMessageComponentCollector({
      filter: (i) => i.user.id === context.member?.id || context.user?.id,
      time: 300_000,
    });

    collector.on("collect", async (interaction) => {
      await interaction.deferUpdate();
      const updates = {
        1: () => (currentPage = 0),
        2: () => currentPage--,
        3: () => currentPage++,
        4: () => (currentPage = embeds.length - 1),
      };
      updates[interaction.customId]();

      buttons.forEach((btn) => {
        btn.setDisabled(
          ((btn.data.custom_id === "1" || btn.data.custom_id === "2") &&
            currentPage === 0) ||
            ((btn.data.custom_id === "3" || btn.data.custom_id === "4") &&
              currentPage === embeds.length - 1)
        );
      });

      await message.edit({ embeds: [embeds[currentPage]], components: [row] });
    });

    collector.on("end", () => {
      buttons.forEach((btn) => btn.setDisabled(true));
      message.edit({ components: [row] }).catch(() => {});
    });
  }
}

module.exports = Util;
