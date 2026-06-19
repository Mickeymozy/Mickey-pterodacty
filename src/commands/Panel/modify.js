const { MessageFlags } = require("discord.js");
const api = require("../../structures/Ptero");
const { adminid } = require('../../../settings');


module.exports = {
  name: "modify",
  description: "Modify Server Resources",

  run: async ({ context }) => {
    if (context.user.id !== adminid){
      return context.createMessage({
        content: "❌ You are not authorized to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }

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

    const PREMIUM_RESOURCES = {
      cpu: 150,
      memory: 4096,
      disk: 5120
    };

    const TARGET_RESOURCES = {
      cpu: 25,
      memory: 200,
      disk: 256,
      swap: 0,
      io: 500,
      threads: null,
      oom_disabled: false,
      feature_limits: {
        databases: 0,
        backups: 1,
        allocations: 1
      }
    };

    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    let page = 1;
    let modifiedCount = 0;

    try {
      while (true) {
        const res = await api.get("/servers", { params: { page, per_page: 100 } });
        const servers = res.data.data || [];
        if (servers.length === 0) break;

        for (const server of servers) {
          const { uuid, id, name, limits, allocation } = server.attributes;

          if (whitelistedServers.includes(uuid)) continue;

          const { cpu, memory, disk } = limits;
          const isPremium =
            cpu === PREMIUM_RESOURCES.cpu &&
            memory === PREMIUM_RESOURCES.memory &&
            disk === PREMIUM_RESOURCES.disk;

          if (isPremium) continue;

          try {
            await api.patch(`/servers/${id}/build`, {
              allocation,
              ...TARGET_RESOURCES
            });

            modifiedCount++;
            console.log(`✅ Modified ${name} (${uuid})`);
            await delay(250);
          } catch (err) {
            console.error(`❌ Failed to update ${name} (${uuid}):`, err?.response?.data || err);
          }
        }

        page++;
      }

      return context.createMessage({
        content: `✅ Successfully modified **${modifiedCount}** servers (non-premium, non-whitelisted).`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      console.error("❌ Error during modify:", err?.response?.data || err);
      return context.createMessage({
        content: "❌ Something went wrong while modifying servers.",
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
