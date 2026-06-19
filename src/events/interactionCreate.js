const {
  EmbedBuilder,
  PermissionFlagsBits,
  InteractionType,
  MessageFlags
} = require("discord.js");
const guildSchema = require("../models/User");

module.exports = async (client, interaction) => {
  if (!client.isReady() || !interaction.guild?.available) return;

  if (interaction.isChatInputCommand()) {
 
    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    await interaction.deferReply();
    const botPerms = interaction.channel.permissionsFor(client.user);
    if (!botPerms.has(PermissionFlagsBits.SendMessages)) {
      const user = await interaction.guild.members.fetch(interaction.user.id);
      return await user
        .send({
          embeds: [
            new EmbedBuilder().setDescription(
              `Please give me Send Messages permission in <#${interaction.channelId}>`
            ),
          ],
        })
        .catch(() => {});
    }

    if (
      !botPerms.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ])
    )
      return;
    if (!botPerms.has(PermissionFlagsBits.EmbedLinks)) {
      return interaction.followUp("I need Embed Links permission!");
    }

    if (
      command.permission &&
      !interaction.member.permissions.has(
        PermissionFlagsBits[command.permission]
      ) &&
      !client.owners?.includes(interaction.user.id)
    ) {
      return interaction.followUp({
        embeds: [
          new EmbedBuilder()
            .setColor("Red")
            .setDescription(`You need ${command.permission} permission!`),
        ],
      });
    }

    try {
      interaction.createMessage = (opts) => interaction.followUp(opts);
      await command.run({ client, context: interaction });
    } catch (error) {
      console.error("Command error:", error);
    }
  }

};
