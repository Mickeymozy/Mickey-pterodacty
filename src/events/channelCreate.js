const { ChannelType } = require('discord.js');

/**
 * @param {import("../structures/Client")} client - The Discord client instance
 * @param {import("discord.js").GuildChannel} channel - The deleted channel
 */
module.exports = async (client, channel) => {
  if (
    channel.type === ChannelType.GuildText &&
    channel.guild.id === '1374783116291477524' &&
    channel.parentId === '1375517232733618227'
  ) {
    setTimeout(() => {
      channel.send(`Hey there! :wave_tone1: \n\nIf you opened this ticket to create a free server, please follow these steps: \n- Use the </register:1375834504463388842> command.\n- Log in to the panel using the provided ID and password. \n- Use the </create:1375834504463388834> command. \n\nYour server will then be created.  \nIf you receive a message like "Failed to create server. Please try again later.", it means we are either out of capacity or server creation is temporarily disabled. In that case, feel free to ping anyone from support team. \n\nIf this ticket wasn't created for the reason stated above, you can ignore this message.\n\n**Regards,**  \n**LeoNodes**`).catch(console.error);
    }, 3000);
  }
}