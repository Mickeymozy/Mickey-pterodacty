const { EmbedBuilder } = require("discord.js");
const User = require("../../models/User");
const api = require("../../structures/Ptero");

module.exports = {
  name: "deleteaccount",
  description: "Delete your panel account and all associated servers.",
  run: async ({ client, context }) => {
    const discordId = context.user?.id;
    if (!discordId) {
      return context.createMessage({
        content: "❌ Internal error: Unable to retrieve your user ID.",
        ephemeral: true,
      });
    }

    const user = await User.findOne({ discordId });
    if (!user) {
      return context.createMessage({
        content: "❌ You don’t have an account registered with us.",
        ephemeral: true,
      });
    }

    try {
      // Fetch all servers (supports up to 1000 servers)
      const allServers = await api.get("/servers?per_page=1000");
      const userServers = allServers.data.data.filter(
        s => s.attributes.user === user.pteroId
      );

      // Check for any suspended servers
      const suspended = userServers.find(s => s.attributes.suspended);
      if (suspended) {
        return context.createMessage({
          content:
            "⚠️ Account cannot be deleted because one or more of your servers are currently suspended. Please contact support.",
          ephemeral: true,
        });
      }

      // Proceed to delete all user servers
      for (const srv of userServers) {
        const serverId = srv.attributes.id;
        await api.delete(`/servers/${serverId}`);
      }

      // Delete user from panel and local DB
      await api.delete(`/users/${user.pteroId}`);
      await User.deleteOne({ discordId });

      return context.createMessage({
        embeds: [
          new EmbedBuilder()
            .setColor("#FF0000")
            .setTitle("🗑️ Account Deleted")
            .setDescription("✅ Your panel account and all associated servers have been permanently deleted.")
            .setFooter({ text: "This message is visible only to you." }),
        ],
        ephemeral: true,
      });

    } catch (err) {
      console.error("Account deletion error:", err.message, err.response?.data || err);
      return context.createMessage({
        content: "❌ Failed to delete your account. Please try again later.",
        ephemeral: true,
      });
    }
  },
};
