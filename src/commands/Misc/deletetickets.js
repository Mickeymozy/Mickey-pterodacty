const { adminid , ticketcategoryid } = require('../../../settings');

module.exports = {
  name: "deletetickets",
  description: "Delete all ticket channels in the specified category",
  run: async ({ context }) => {

    if (context.user.id !== adminid) {
      return await context.createMessage({ content: "❌ You are not authorized to use this command.", ephemeral: true });
    }

    const guild = context.guild;
    if (!guild) {
      return await context.createMessage({ content: "❌ This command can only be used in a guild.", ephemeral: true });
    }

    const categoryId = "1375517232733618227";

    // Fetch the category channel to ensure it exists
    const category = guild.channels.cache.get(categoryId);
    if (!category || category.type !== 4) { // 4 = GUILD_CATEGORY
      return await context.createMessage({ content: "❌ Category not found.", ephemeral: true });
    }

    // Filter all channels in that category with names starting with "ticket" or "closed"
    const channelsToDelete = guild.channels.cache.filter(
      (ch) =>
        ch.parentId === categoryId &&
        (ch.name.toLowerCase().startsWith("ticket") || ch.name.toLowerCase().startsWith("closed"))
    );


    if (channelsToDelete.size === 0) {
      return await context.createMessage({ content: "No ticket channels found to delete.", ephemeral: true });
    }

    // Delete channels one by one
    try {
      for (const [channelId, channel] of channelsToDelete) {
        await channel.delete("Ticket cleanup command used");
      }

      return await context.createMessage({ content: `✅ Deleted ${channelsToDelete.size} ticket channels.` });
    } catch (error) {
      console.error("Error deleting channels:", error);
      return await context.createMessage({ content: "❌ Failed to delete some or all channels." });
    }
  },
};
