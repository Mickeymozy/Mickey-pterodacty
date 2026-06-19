const { MessageFlags } = require("discord.js");
const api = require("../../structures/Ptero");

module.exports = {
  name: "slots",
  description: "📊 Shows current usage vs. max slots for each tier",

  run: async ({ context }) => {
    const whitelisted = new Set([
      "c47c3ff8-7076-449d-961e-ca1b3f3c0ca3",
      "702f85a2-6dea-4ac8-bf76-c2cd48567594",
      "155da30d-d69e-488c-b43b-736e983ea9f4",
      "1bc089ff-1355-4187-8c86-3a918636cf06",
      "6df028d4-975f-4efb-83d1-2c8e613c10a4",
      "3d64f61d-be76-4f83-a5c2-26112dc8f897",
      "151f6d76-04ba-422e-abc8-d80588151e59",
    ]);

    const tiers = [
      { name: "Premium", cpu: 150, memory: 4096, disk: 5120, max: 5 },
      { name: "Free", cpu: 50, memory: 512, disk: 1024, max:  45 },
    ];

    const usage = Object.fromEntries(tiers.map(t => [t.name, 0]));

    let page = 1;

    try {
      while (true) {
        const res = await api.get("/servers", {
          params: { page, per_page: 100 },
        });

        const servers = res.data.data;
        if (!servers.length) break;

        for (const s of servers) {
          const { uuid, limits } = s.attributes;
          if (whitelisted.has(uuid)) continue;

          for (const tier of tiers) {
            if (
              limits.cpu === tier.cpu &&
              limits.memory === tier.memory &&
              limits.disk === tier.disk
            ) {
              usage[tier.name]++;
              break;
            }
          }
        }

        page++;
      }

      // Create message content
      const lines = tiers.map(tier => {
        const used = usage[tier.name] || 0;
        const left = tier.max - used;
        return `**${tier.name}**: ${used}/${tier.max} used (${left} slots left)`;
      });

      return context.createMessage({
        content: `📊 **Current Tier Usage:**\n\n${lines.join("\n")}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      console.error("Failed to fetch slots:", err?.response?.data || err);
      return context.createMessage({
        content: "❌ Failed to fetch slot data.",
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
